import { Inverter } from "../../inverter";
import APsystemsApi from "./api";
import { DeviceData, DeviceSettings, SystemInfo, RealTimeData } from "./types";

const ACTIVE_ECU_ID_STORE_KEY = "apsystemsActiveEcuId";
const ACTIVE_ECU_IP_STORE_KEY = "apsystemsActiveEcuIp";
const LIFETIME_ENERGY_OFFSET_STORE_KEY = "apsystemsLifetimeEnergyOffset";
const LAST_LIFETIME_ENERGY_STORE_KEY = "apsystemsLastLifetimeEnergy";

class ASsystemsDevice extends Inverter {
  interval = this.getSetting("interval");
  api?: APsystemsApi;
  private activeIp?: string;

  async onInit() {
    const data: DeviceData = this.getData();
    const settings: DeviceSettings = this.getSettings();

    if (!this.hasCapability("meter_power.total")) {
      await this.addCapability("meter_power.total");
    }

    const storedIp = this.getStoreValue(ACTIVE_ECU_IP_STORE_KEY);
    const storedEcuID = this.getStoreValue(ACTIVE_ECU_ID_STORE_KEY);
    const ip = typeof storedIp === "string" && storedIp
      ? storedIp
      : settings.ecuIP || data.ip;
    const ecuID = typeof storedEcuID === "string" && storedEcuID
      ? storedEcuID
      : settings.ecuId || data.ecuID;
    const previousEcuID = typeof storedEcuID === "string" && storedEcuID
      ? storedEcuID
      : data.ecuID;

    this.activeIp = ip;
    this.api = new APsystemsApi(ip, ecuID);

    try {
      const systemInfo: SystemInfo = await this.api.getSystemInfo();

      if (previousEcuID && systemInfo.id !== previousEcuID) {
        this.homey.log(`Detected replacement ECU ${systemInfo.id}; previous ECU was ${previousEcuID}`);
      }

      await this.activateEcu(ip, systemInfo, previousEcuID);
    } catch (err) {
      const errorMessage = (err as Error).message;
      this.homey.log(`Unable to initialize APsystems ECU: ${errorMessage}`);
      await this.setUnavailable(errorMessage);
    }

    super.onInit();
  }

  async replaceEcu(ip: string, expectedEcuID?: string): Promise<SystemInfo> {
    const normalizedIp = ip.trim();
    if (!normalizedIp) {
      throw new Error("Please enter an ECU IP address");
    }

    // System info does not require an ECU ID, so it can be used to discover
    // and validate a replacement ECU before changing this Homey device.
    const candidateApi = new APsystemsApi(normalizedIp);
    const systemInfo: SystemInfo = await candidateApi.getSystemInfo();

    if (expectedEcuID && systemInfo.id !== expectedEcuID) {
      throw new Error(
        `The ECU at ${normalizedIp} changed while repairing. Expected ${expectedEcuID}, found ${systemInfo.id}.`
      );
    }

    const data: DeviceData = this.getData();
    const storedEcuID = this.getStoreValue(ACTIVE_ECU_ID_STORE_KEY);
    const previousEcuID = typeof storedEcuID === "string" && storedEcuID
      ? storedEcuID
      : data.ecuID;

    await this.activateEcu(normalizedIp, systemInfo, previousEcuID);
    await this.setAvailable();

    this.homey.log(
      `APsystems ECU reinitialized: ${previousEcuID || "unknown"} -> ${systemInfo.id} at ${normalizedIp}`
    );

    return systemInfo;
  }

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    newSettings: object;
    changedKeys: string[];
  }) {
    // TODO: fix typing once Athom fixes their TypeScript implementation
    const typedNewSettings = newSettings as DeviceSettings;

    if (changedKeys.includes("interval") && typedNewSettings.interval) {
      this.resetInterval(typedNewSettings.interval);
      this.homey.log(`Changed interval to ${typedNewSettings.interval}`);
    }
  }

  async checkProduction(): Promise<void> {
    this.homey.log("Checking production");

    if (this.api) {
      try {
        // Production values
        const systemInfo: SystemInfo = await this.api.getSystemInfo();

        const settings: DeviceSettings = this.getSettings();
        const data: DeviceData = this.getData();
        const storedEcuID = this.getStoreValue(ACTIVE_ECU_ID_STORE_KEY);
        const configuredEcuID = typeof storedEcuID === "string" && storedEcuID
          ? storedEcuID
          : data.ecuID;

        // getSystemInfo() does not depend on the configured ECU ID. This lets
        // us transparently detect a physical ECU replacement on the same IP.
        if (configuredEcuID && systemInfo.id !== configuredEcuID) {
          const ip = this.activeIp || settings.ecuIP || data.ip;
          this.homey.log(`Detected replacement ECU ${systemInfo.id}; previous ECU was ${configuredEcuID}`);
          await this.activateEcu(ip, systemInfo, configuredEcuID);
        }

        // Keep the ECU status shown in device settings up to date.
        // The online count can change while the app is running, so only write
        // settings when one of the values actually changed.
        await this.updateEcuStatusSettings(systemInfo);

        const realTimeData: RealTimeData = await this.api.getRealTimeData();

        // Production power
        if (!isNaN(systemInfo.lastSystemPower as number)) {
          await this.setCapabilityValue(
            "measure_power",
            systemInfo.lastSystemPower
          );
        }

        // Daily production energy
        if (!isNaN(systemInfo.currentDayEnergy as number)) {
          await this.setCapabilityValue(
            "meter_power",
            systemInfo.currentDayEnergy
          );
        }

        // Lifetime production energy. Keep the cumulative meter continuous
        // when a replacement ECU starts with another lifetime counter value.
        if (!isNaN(systemInfo.lifeTimeEnergy as number)) {
          const lifetimeEnergy = systemInfo.lifeTimeEnergy + this.getLifetimeEnergyOffset();

          await this.setCapabilityValue(
            "meter_power.total",
            lifetimeEnergy
          );
          await this.setStoreValue(LAST_LIFETIME_ENERGY_STORE_KEY, lifetimeEnergy);
        }

        for (let i = 1; i <= realTimeData.numberOfInverters; i++) {
          const inverterInfo = realTimeData.inverters[i - 1];

          for (let j = 1; j <= inverterInfo.powers.length; j++) {
            const power = inverterInfo.powers[j - 1];

            if (!isNaN(power as number)) {
              const capabilityID = `measure_power.${inverterInfo.inverterId}.power${j + 1}`;

              if (!this.hasCapability(capabilityID)) {
                await this.addCapability(capabilityID);

                await this.setCapabilityOptions(capabilityID, {
                  "title": {
                    "en": `Inverter ${inverterInfo.inverterId} power ${j}`,
                    "nl": `Inverter ${inverterInfo.inverterId} vermogen ${j}`
                  }
                });
              }

              await this.setCapabilityValue(
                capabilityID,
                power
              );
            }

          }

          for (let j = 1; j <= inverterInfo.voltages.length; j++) {
            const voltage = inverterInfo.voltages[j - 1];

            if (!isNaN(voltage as number)) {
              const capabilityID = `measure_voltage.${inverterInfo.inverterId}.voltage${j}`;

              if (!this.hasCapability(capabilityID)) {
                await this.addCapability(capabilityID);

                await this.setCapabilityOptions(capabilityID, {
                  "title": {
                    "en": `Inverter ${inverterInfo.inverterId} voltage ${j}`,
                    "nl": `Inverter ${inverterInfo.inverterId} spanning ${j}`
                  }
                });
              }

              await this.setCapabilityValue(
                capabilityID,
                voltage
              );
            }

          }

          const temperatureCapabilityID = `measure_temperature.${inverterInfo.inverterId}`;
          if (!this.hasCapability(temperatureCapabilityID)) {
            await this.addCapability(temperatureCapabilityID);

            await this.setCapabilityOptions(temperatureCapabilityID, {
              "title": {
                "en": `Inverter ${inverterInfo.inverterId} temperature`,
                "nl": `Inverter ${inverterInfo.inverterId} temperatuur`
              }
            });
          }

          await this.setCapabilityValue(
            temperatureCapabilityID,
            inverterInfo.temperature
          );

          const frequencyCapabilityID = `measure_frequency.${inverterInfo.inverterId}`;
          if (!this.hasCapability(frequencyCapabilityID)) {
            await this.addCapability(frequencyCapabilityID);

            await this.setCapabilityOptions(frequencyCapabilityID, {
              "title": {
                "en": `Inverter ${inverterInfo.inverterId} frequency`,
                "nl": `Inverter ${inverterInfo.inverterId} frequentie`
              }
            });
          }

          await this.setCapabilityValue(
            frequencyCapabilityID,
            inverterInfo.frequency
          );

          const onoffCapabilityID = `onoff.${inverterInfo.inverterId}`;
          if (!this.hasCapability(onoffCapabilityID)) {
            await this.addCapability(onoffCapabilityID);

            await this.setCapabilityOptions(onoffCapabilityID, {
              "title": {
                "en": `Inverter ${inverterInfo.inverterId} online`,
                "nl": `Inverter ${inverterInfo.inverterId} online`
              },
              "setable": false
            });
          }

          await this.setCapabilityValue(
            onoffCapabilityID,
            inverterInfo.online
          );
        }

        await this.setAvailable();

      } catch (err) {
        const errorMessage = (err as Error).message;

        this.homey.log(`Unavailable: ${errorMessage}`);
        await this.setUnavailable(errorMessage);
      }
    } else {
      await this.setUnavailable("APsystems connection not initialized");
    }
  }

  private async activateEcu(
    ip: string,
    systemInfo: SystemInfo,
    previousEcuID?: string
  ): Promise<void> {
    if (previousEcuID && previousEcuID !== systemInfo.id) {
      await this.rebaseLifetimeEnergy(systemInfo.lifeTimeEnergy);
    }

    this.activeIp = ip;
    this.api = new APsystemsApi(ip, systemInfo.id);

    await this.setStoreValue(ACTIVE_ECU_ID_STORE_KEY, systemInfo.id);
    await this.setStoreValue(ACTIVE_ECU_IP_STORE_KEY, ip);

    await this.setSettings({
      'ecuId': systemInfo.id,
      'ecuFirmware': systemInfo.version,
      'ecuIP': ip,
      'inverters': String(systemInfo.numberOfInverters),
      'invertersOnline': String(systemInfo.invertersOnline)
    });
  }

  private async updateEcuStatusSettings(systemInfo: SystemInfo): Promise<void> {
    const settings: DeviceSettings = this.getSettings();
    const updatedSettings: Partial<DeviceSettings> = {};

    const numberOfInverters = String(systemInfo.numberOfInverters);
    const invertersOnline = String(systemInfo.invertersOnline);

    if (settings.inverters !== numberOfInverters) {
      updatedSettings.inverters = numberOfInverters;
    }

    if (settings.invertersOnline !== invertersOnline) {
      updatedSettings.invertersOnline = invertersOnline;
    }

    if (Object.keys(updatedSettings).length > 0) {
      await this.setSettings(updatedSettings);
    }
  }

  private getLifetimeEnergyOffset(): number {
    const storedOffset = this.getStoreValue(LIFETIME_ENERGY_OFFSET_STORE_KEY);
    return typeof storedOffset === "number" && Number.isFinite(storedOffset)
      ? storedOffset
      : 0;
  }

  private async rebaseLifetimeEnergy(newRawLifetimeEnergy: number): Promise<void> {
    const capabilityValue = this.getCapabilityValue("meter_power.total");
    const storedValue = this.getStoreValue(LAST_LIFETIME_ENERGY_STORE_KEY);

    const previousLifetimeEnergy =
      typeof capabilityValue === "number" && Number.isFinite(capabilityValue)
        ? capabilityValue
        : typeof storedValue === "number" && Number.isFinite(storedValue)
          ? storedValue
          : undefined;

    if (previousLifetimeEnergy === undefined) {
      await this.setStoreValue(LIFETIME_ENERGY_OFFSET_STORE_KEY, 0);
      return;
    }

    const newOffset = previousLifetimeEnergy - newRawLifetimeEnergy;
    await this.setStoreValue(LIFETIME_ENERGY_OFFSET_STORE_KEY, newOffset);

    this.homey.log(
      `Rebased lifetime energy meter: previous=${previousLifetimeEnergy}, new ECU=${newRawLifetimeEnergy}, offset=${newOffset}`
    );
  }

}

module.exports = ASsystemsDevice;
