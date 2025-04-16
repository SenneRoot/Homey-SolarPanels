import { Driver } from "homey";
import PairSession from "homey/lib/PairSession";

import ASsystemsApi from "./api";
import { PairData, Device } from "./types";
import APsystemsApi from "./api";

class ASsystemsDriver extends Driver {
  ecuID?: string;
  ip?: string;

  async onPair(session: PairSession) {
    session.setHandler("validate", async (data: PairData) => {
      this.homey.log("Pair data received");

      const { ecuID, ip } = data;
      this.ecuID = ecuID;
      this.ip = ip;

      return new ASsystemsApi(this.ip, this.ecuID).getSystemInfo();
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
}

module.exports = ASsystemsDriver;
