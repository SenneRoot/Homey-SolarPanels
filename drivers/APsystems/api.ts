import { Inverter, RealTimeData, SystemInfo } from "./types";
import { aps_datetimestamp, aps_bcd_str, validate_data, aps_inverter_type, aps_inverter_powers_voltages } from "./ecuHelpers"

const net = require("net");
const Parser = require('binary-parser').Parser

const REQ_SYSTEMINFO = 'APS1100160001';
const REQ_REAL_TIME_DATA = 'APS1100280002';
const REQ_POWER_OF_DAY = 'APS1100390003';
const REQ_INVERTER_SIGNAL_LEVEL = 'APS1100280030';
const REQ_ENERGY_OF_WMY = 'APS1100390004';
const REQ_WEEK = '00';
const REQ_MONTH = '01';
const REQ_YEAR = '02';
const REQ_END = 'END';


export default class APsystemsApi {
  private ip: string;
  private ecuID?: string;
  private port: number;
  private responseParser: typeof Parser;

  constructor(ip: string, ecuID?: string) {
    this.ip = ip;
    this.port = 8899;
    this.ecuID = ecuID;

    const systemInfoParser = new Parser()
      .string('ecuId', { length: 12 })
      .string('ecuModel', { length: 2, formatter: function (str: any) { return parseInt(str) } })
      .int32('lifeTimeEnergy')
      .int32('lastSystemPower')
      .int32('currentDayEnergy')
      .choice(null, {
        tag: 'ecuModel',
        choices: {
          0x01: Parser.start()
            .array('lastTimeConnectedEMA', { type: 'uint8', length: 7 })
            .int16('numberOfInverters')
            .int16('invertersOnline')
            .string('ecuChannel', { length: 2 })
            .string('vlen', { length: 3 })
            .string('firmware', { length: function (this: any) { return parseInt(this.vlen); } })
            .string('tlen', { length: 3 })
            .string('timeZone', { length: function (this: any) { return parseInt(this.tlen); } })
            .array('ethernetMAC', { type: 'uint8', length: 6 })
            .array('wirelessMAC', { type: 'uint8', length: 6 }),
          0x02: Parser.start()
            .int16('numberOfInverters')
            .int16('invertersOnline')
            .string('ecuChannel', { length: 2 })
            .string('vlen', { length: 3 })
            .string('firmware', { length: function (this: any) { return parseInt(this.vlen); } })
        }
      })

    const realTimeInfoParser = new Parser()
      .string('MatchStatus', { length: 2, assert: '00' })
      .string('ecuModel', { length: 2, formatter: function (str: any) { return parseInt(str) } })
      .int16('numberOfInverters')
      .array('dateTime', { type: 'uint8', length: 7, formatter: function (arr: any) { return aps_datetimestamp(arr); } })
      .array('inverters', {
        length: 'numberOfInverters',
        type: Parser.start()
          .array('inverterId', { type: 'uint8', length: 6, formatter: function (arr: any) { return aps_bcd_str(arr); } })
          .int8('state')
          .string('inverterType', { length: 2, formatter: function (str: any) { return parseInt(str) } })
          .int16('frequency')
          .int16('temperature')
          .choice(null, {
            tag: 'inverterType',
            choices: {
              0x01: Parser.start().int16('power1').int16('voltage1').int16('power2').int16('voltage2'),
              0x02: Parser.start().int16('power1').int16('voltage1').int16('power2').int16('voltage2').int16('power3').int16('voltage3').int16('power4').int16('voltage4'),
              0x03: Parser.start().int16('power1').int16('voltage1').int16('power2').int16('power3').int16('power4'),
              0x04: Parser.start().int16('power1').int16('voltage1').int16('power2').int16('voltage2'),
              0x05: Parser.start().int16('power1').int16('voltage1').int16('power2').int16('voltage2'),
            }
          })
      });

    this.responseParser = new Parser()
      .string('signatureStart', { length: 3 })
      .string('commandGroup', { length: 2 })
      .string('frameLength', { length: 4 })
      .string('commandCode', { length: 4, formatter: function (str: any) { return parseInt(str) } })
      .choice(null, {
        tag: 'commandCode',
        choices: {
          1: systemInfoParser,
          2: realTimeInfoParser,
        }
      })
      .string('SignaturEnd', { length: 4 });
  }

  private async sendCommandToECU(command: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();

      client.connect(this.port, this.ip, () => {
        client.write(command);
      });

      client.on("data", (data: Buffer) => {
        client.destroy(); // Close connection after receiving data
        resolve(data);
      });

      client.on("error", (err: Error) => {
        client.destroy();
        reject(err);
      });

      client.on("close", () => {
      });
    });
  }

  async getSystemInfo(): Promise<SystemInfo> {
    const data = await this.sendCommandToECU(REQ_SYSTEMINFO + REQ_END);

    if (validate_data(data, '0001')) {
      const parsedData = this.responseParser.parse(data);
      return {
        id: parsedData.ecuId,
        model: parsedData.ecuModel,
        lifeTimeEnergy: parsedData.lifeTimeEnergy / 10,
        lastSystemPower: parsedData.lastSystemPower,
        currentDayEnergy: parsedData.currentDayEnergy / 100,
        numberOfInverters: parsedData.inverters,
        invertersOnline: parsedData.invertersOnline,
        version: parsedData.firmware,
        timeZone: parsedData.timeZone
      }
    }
    else {
      throw new Error(`Received incorrect response from ECU: command: ${REQ_SYSTEMINFO + REQ_END} response: ${data}`)
    }
  }

  async getRealTimeData(): Promise<RealTimeData> {
    // fetch ecu id from system info if unkown
    if (!this.ecuID) {
      this.ecuID = (await this.getSystemInfo()).id;
    }

    const data = await this.sendCommandToECU(REQ_REAL_TIME_DATA + this.ecuID + REQ_END);

    if (validate_data(data, '0002')) {

      const parsedData = this.responseParser.parse(data);
      let inverters: Inverter[] = [];

      for (const inverter of parsedData.inverters) {
        const { powers, voltages } = aps_inverter_powers_voltages(inverter.inverterType, inverter);

        inverters.push({
          inverterId: inverter.inverterId,
          state: inverter.state,
          inverterType: aps_inverter_type(inverter.inverterType),
          online: inverter.state == 1,
          frequency: inverter.frequency / 10.0,
          temperature: inverter.temperature - 100.0,
          powers: powers,
          voltages: voltages
        });
      }

      return {
        ecuModel: parsedData.ecuModel,
        numberOfInverters: parsedData.numberOfInverters,
        dateTime: parsedData.dateTime,
        inverters: inverters,
      }
    }
    else {
      throw new Error(`Received incorrect response from ECU: command: ${REQ_REAL_TIME_DATA + this.ecuID + REQ_END} response: ${data}`)
    }
  }
}
