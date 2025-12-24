
import { VehicleRecord } from './types';

export const sortDatabase = (data: VehicleRecord[]): VehicleRecord[] => {
  return [...data].sort((a, b) => {
    // Primary: Manufacturer (A-Z)
    const mCompare = a.Manufacturer.localeCompare(b.Manufacturer);
    if (mCompare !== 0) return mCompare;

    // Secondary: Model (A-Z)
    const modelCompare = a.Model.localeCompare(b.Model);
    if (modelCompare !== 0) return modelCompare;

    // Tertiary: Start_Year (Ascending)
    return a.Start_Year - b.Start_Year;
  });
};

export const convertToCSV = (data: VehicleRecord[]): string => {
  const headers = ['Manufacturer', 'Model', 'Generation', 'Model_Code', 'Start_Year', 'End_Year'];
  const rows = data.map(record => 
    headers.map(header => record[header as keyof VehicleRecord]).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
};

/**
 * Extracts only digits from a string to normalize generation numbers.
 */
const cleanGeneration = (val: string): string => {
  const match = val.match(/\d+/);
  return match ? match[0] : val;
};

export const parseCSV = (content: string): VehicleRecord[] => {
  const lines = content.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const expectedHeaders = ['Manufacturer', 'Model', 'Generation', 'Model_Code', 'Start_Year', 'End_Year'];
  
  const isValidHeader = expectedHeaders.every(h => headers.includes(h));
  if (!isValidHeader) {
    throw new Error('פורמט הכותרות אינו תקין. נדרש: Manufacturer, Model, Generation, Model_Code, Start_Year, End_Year');
  }

  const results: VehicleRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length < expectedHeaders.length) continue;

    const record: any = {};
    headers.forEach((header, index) => {
      let val: any = values[index];
      if (header === 'Start_Year') {
        const parsedYear = parseInt(val, 10);
        if (isNaN(parsedYear)) throw new Error(`שנה לא תקינה בשורה ${i + 1}: ${val}`);
        val = parsedYear;
      }
      if (header === 'Generation') {
        val = cleanGeneration(val);
      }
      record[header] = val;
    });
    results.push(record as VehicleRecord);
  }
  return results;
};

export const downloadCSV = (content: string, filename: string = 'vehicle_database.csv') => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const isDuplicate = (existing: VehicleRecord[], record: VehicleRecord): boolean => {
  return existing.some(item => 
    item.Manufacturer.toLowerCase() === record.Manufacturer.toLowerCase() &&
    item.Model.toLowerCase() === record.Model.toLowerCase() &&
    item.Generation.toLowerCase() === record.Generation.toLowerCase() &&
    item.Model_Code.toLowerCase() === record.Model_Code.toLowerCase() &&
    item.Start_Year === record.Start_Year
  );
};
