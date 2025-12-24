
export interface VehicleRecord {
  Manufacturer: string;
  Model: string;
  Generation: string;
  Model_Code: string;
  Start_Year: number;
  End_Year: string; // "YYYY" or "Present"
}

export enum AgentStatus {
  IDLE = 'IDLE',
  INITIALIZING = 'INITIALIZING',
  ANALYZING = 'ANALYZING',
  READY_FOR_EXPANSION = 'READY_FOR_EXPANSION',
  UPDATING = 'UPDATING',
  ERROR = 'ERROR'
}

export interface ExpansionSuggestion {
  Manufacturer: string;
  Model: string;
  Generation: string;
  Model_Code: string;
  Start_Year: number;
  End_Year: string;
}
