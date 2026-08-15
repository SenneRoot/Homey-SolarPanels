export interface SystemInfo {
  id: string;
  model: number;
  lifeTimeEnergy: number;
  lastSystemPower: number;
  currentDayEnergy: number;
  numberOfInverters: number;
  invertersOnline: number;
  version: string;
  timeZone: string;
  ethernetMac?: string;
  wirelessMac?: string;
}

export interface Inverter {
  inverterId: string;
  state: number;
  inverterType: string;
  online: Boolean;
  frequency: number;
  temperature: number;
  powers: number[];
  voltages: number[];
}

export interface RealTimeData {
  ecuModel: string;
  numberOfInverters: number;
  dateTime: string;
  inverters: Inverter[];
}

// Homey types
export interface PairData {
  ecuID?: string;
  ip: string;
}

export interface RepairData {
  ip: string;
  expectedEcuID?: string;
}

export interface Device {
  name: string;
  data: DeviceData;
  settings: DeviceSettings;
}

export interface DeviceData {
  ecuID: string;
  ip: string;
}

export interface DeviceSettings {
  interval?: number;
  ecuId?: string;
  ecuFirmware?: string;
  ecuIP?: string;
  inverters?: string;
  invertersOnline?: string;
}
