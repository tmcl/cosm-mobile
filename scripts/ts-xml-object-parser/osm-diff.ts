// ai! please use ts-xml-object-parser/index.ts to write an xml parser/builder for OsmChange (the OpenStreetMap xml diff format)

type OsmChange = { version: string, generator: string, create : OsmChangeElements, modify : OsmChangeElements, delete: OsmChangeElements }
type OsmChangeElements = OsmChangeElement[]

type OsmChangeElement = IOCENode | IOCEWay

export interface IOCENode {
  tag: "node";
  id: number;
  changeset: number;
  lat: number;
  lon: number;
}

export interface IOCEWay {
  tag: "way";
  id: number;
  changeset: number;
  oceWayNodes: IOCEWayNode[];
}

export interface IOCEWayNode {
  ref: number;
}
