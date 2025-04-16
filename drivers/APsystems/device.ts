import { Device } from "homey";
import { Inverter } from "../../inverter";
import ASsystemsApi from "./api";
import { DeviceData, DeviceSettings, SystemInfo, RealTimeData } from "./types";

class ASsystemsDevice extends Inverter {
  interval = this.getSetting("interval");
  api?: ASsystemsApi;

  async onInit() {
    const data: DeviceData = this.getData();
    const settings: DeviceSettings = this.getSettings();

    this.api = new ASsystemsApi(data.ip, data.ecuID);
    const systemInfo: SystemInfo = await this.api.getSystemInfo();

    await this.setSettings({
      'ecuId': systemInfo.id,
      'ecuFirmware': systemInfo.version,
      'ecuIP': data.ip,
      'inverters': systemInfo.numberOfInverters
    });

    await this.addCapability("meter_power.total");

    super.onInit();
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

    const settings: DeviceSettings = this.getSettings();

    if (this.api) {
      try {
        // Production values
        const systemInfo: SystemInfo = await this.api.getSystemInfo();
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

        // Lifetime production energy
        if (!isNaN(systemInfo.lifeTimeEnergy as number)) {

          await this.setCapabilityValue(
            "meter_power.total",
            systemInfo.lifeTimeEnergy
          );
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
      await this.setUnavailable("ASsystems connection not initialized");
    }
  }

}

module.exports = ASsystemsDevice;
