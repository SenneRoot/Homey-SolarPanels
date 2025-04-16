export function aps_datetimestamp(buffer: Uint8Array): string {
  const timestr = aps_bcd_str(buffer)
  return `${timestr.slice(0, 4)}-${timestr.slice(4, 6)}-${timestr.slice(6, 8)} ${timestr.slice(8, 10)}:${timestr.slice(10, 12)}:${timestr.slice(12, 14)}`;
}

export function aps_bcd_str(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function aps_str(codec: Uint8Array, start: number, amount: number): string {
  const slice = codec.slice(start, start + amount);
  return new TextDecoder('utf-8').decode(slice);
}

export function aps_int(codec: Uint8Array, start: number, length: number): number {
  const slice = codec.slice(start, start + length);
  return slice.reduce((acc, byte) => (acc << 8) | byte, 0);
}

export function aps_inverter_type(modelCode: number): string {
  switch (modelCode) {
    case 0x01:
      return 'YC600/DS3';
    case 0x02:
      return 'YC1000/QT2';
    case 0x03:
      return 'QS1';
    case 0x04:
      return 'DS3D-L';
    case 0x05:
      return 'DS3-H';
    default:
      return 'Unkown model'
  }
}

export function aps_inverter_powers_voltages(modelCode: number, inverter: any): any {
  let powers: number[] = [];
  let voltages: number[] = [];

  switch (modelCode) {
    case 0x01:
    case 0x04:
    case 0x05:
      powers.push(inverter.power1);
      powers.push(inverter.power2);
      voltages.push(inverter.voltage1);
      voltages.push(inverter.voltage2);
      break;
    case 0x02:
      powers.push(inverter.power1);
      powers.push(inverter.power2);
      powers.push(inverter.power3);
      powers.push(inverter.power4);
      voltages.push(inverter.voltage1);
      voltages.push(inverter.voltage2);
      voltages.push(inverter.voltage3);
      voltages.push(inverter.voltage4);
      break;
    case 0x03:
      powers.push(inverter.power1);
      powers.push(inverter.power2);
      powers.push(inverter.power3);
      powers.push(inverter.power4);
      voltages.push(inverter.voltage1);
      break;
  }

  return { powers, voltages };
}

export function validate_data(data: Uint8Array, commandNumber: string): boolean {
  const datalen = data.length - 1;
  const debugData = aps_bcd_str(data);

  const checksum = parseInt(aps_str(data, 5, 4));

  if (datalen !== checksum) {
    console.log(`checksum error on: checksum=${checksum} datalen=${datalen} data=${debugData}`);
    return false;
  }

  if (aps_str(data, 0, 3) !== 'APS' || aps_str(data, data.length - 4, 3) !== 'END') {
    console.log(`signature error on: data=${debugData}`);
    return false;
  }

  if (aps_str(data, 9, 4) !== commandNumber) {
    console.log(`requested command ${commandNumber} does not match received command ${aps_str(data, 9, 4)}`);
    return false;
  }

  return true;
}
