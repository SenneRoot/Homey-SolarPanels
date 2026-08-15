import { Device as HomeyDevice, Driver } from "homey";
import PairSession from "homey/lib/PairSession";

import APsystemsApi from "./api";
import {
  PairData,
  Device,
  DeviceData,
  DeviceSettings,
  RepairData,
  SystemInfo,
} from "./types";

type RepairableAPsystemsDevice = HomeyDevice & {
  replaceEcu(ip: string, expectedEcuID?: string): Promise<SystemInfo>;
};

class ASsystemsDriver extends Driver {
  ecuID?: string;
  ip?: string;

  async onPair(session: PairSession) {
    session.setHandler("validate", async (data: PairData) => {
      this.homey.log("Pair data received");

      const { ecuID, ip } = data;
      this.ecuID = ecuID;
      this.ip = ip;

      return new APsystemsApi(this.ip, this.ecuID).getSystemInfo();
    });

    session.setHandler("list_devices", async () => {
      this.homey.log("Listing devices");

      const devicesList: Device[] = [];

      if (this.ip) {
        const systemInfo = await new APsystemsApi(
          this.ip
        ).getSystemInfo();

        devicesList.push({
          name: systemInfo.id ? systemInfo.id : 'Unkown',
          data: {
            ecuID: systemInfo.id ? systemInfo.id : "Unkown",
            ip: this.ip,
          },
          settings: {

          },
        });
      }

      return devicesList;
    });
  }
  async onRepair(session: PairSession, device: HomeyDevice) {
    const apsystemsDevice = device as RepairableAPsystemsDevice;

    session.setHandler("get_current_ecu", async () => {
      const settings = device.getSettings() as DeviceSettings;
      const data = device.getData() as DeviceData;

      return {
        ip: settings.ecuIP || data.ip,
        ecuID: settings.ecuId || data.ecuID,
      };
    });

    session.setHandler("validate_repair", async (data: RepairData) => {
      const ip = data.ip.trim();
      if (!ip) {
        throw new Error("Please enter an ECU IP address");
      }

      this.homey.log(`Validating replacement APsystems ECU at ${ip}`);
      return new APsystemsApi(ip).getSystemInfo();
    });

    session.setHandler("replace_ecu", async (data: RepairData) => {
      const ip = data.ip.trim();
      if (!ip) {
        throw new Error("Please enter an ECU IP address");
      }

      this.homey.log(`Replacing APsystems ECU with ECU at ${ip}`);
      return apsystemsDevice.replaceEcu(ip, data.expectedEcuID);
    });
  }

}

module.exports = ASsystemsDriver;
