import { Parser, Builder, parseRoot, buildRoot, parseObject, buildObject, pickleStringParser, pickleStringBuilder, pickleNumberParser, pickleNumberBuilder, parseArray, buildArray, type Result } from './index';

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

const wayNodePickler: PicklerObject<IOCEWayNode> = {
  ref: { 
    type: "attribute",
    parser: pickleNumberParser,
    builder: pickleNumberBuilder
  }
};

const nodePickler: PicklerObject<IOCENode> = {
  id: { type: "attribute", parser: pickleNumberParser, builder: pickleNumberBuilder },
  changeset: { type: "attribute", parser: pickleNumberParser, builder: pickleNumberBuilder },
  lat: { type: "attribute", parser: pickleNumberParser, builder: pickleNumberBuilder },
  lon: { type: "attribute", parser: pickleNumberParser, builder: pickleNumberBuilder },
  tag: { type: "attribute", parser: { parse: () => ({ success: "node" }), build: () => [] }, builder: { build: () => [] } }
};

const wayPickler: PicklerObject<IOCEWay> = {
  id: { type: "attribute", parser: pickleNumberParser, builder: pickleNumberBuilder },
  changeset: { type: "attribute", parser: pickleNumberParser, builder: pickleNumberBuilder },
  oceWayNodes: {
    type: "element",
    xmlname: "nd",
    parser: parseArray(parseObject(wayNodePickler)),
    builder: buildArray(buildObject(wayNodePickler))
  },
  tag: { type: "attribute", parser: { parse: () => ({ success: "way" }), build: () => [] }, builder: { build: () => [] } }
};

const osmChangeElementPickler = {
  node: { type: "element", parser: parseObject(nodePickler), builder: buildObject(nodePickler) },
  way: { type: "element", parser: parseObject(wayPickler), builder: buildObject(wayPickler) }
} as const;

const osmChangeElementsPickler = {
  create: { type: "element", xmlname: "create", parser: parseArray(parseObject(osmChangeElementPickler)), builder: buildArray(buildObject(osmChangeElementPickler)) },
  modify: { type: "element", xmlname: "modify", parser: parseArray(parseObject(osmChangeElementPickler)), builder: buildArray(buildObject(osmChangeElementPickler)) },
  delete: { type: "element", xmlname: "delete", parser: parseArray(parseObject(osmChangeElementPickler)), builder: buildArray(buildObject(osmChangeElementPickler)) }
};

const osmChangePickler: PicklerObject<OsmChange> = {
  version: { type: "attribute", parser: pickleStringParser, builder: pickleStringBuilder },
  generator: { type: "attribute", parser: pickleStringParser, builder: pickleStringBuilder },
  ...osmChangeElementsPickler
};

export const parseOsmChange = parseRoot("osmChange", parseObject(osmChangePickler));
export const buildOsmChange = buildRoot("osmChange", buildObject(osmChangePickler));
