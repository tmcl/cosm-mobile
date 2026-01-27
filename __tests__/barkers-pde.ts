import * as ModalNotes from "@/components/diff-info/index";
import {
  IntersectingWayInfo,
  PartialRecord,
  TargetNode,
  WayId,
} from "@/components/types";
import type GeoJSON from "geojson";
import { NearestPoint, StopSignChange } from "@/components/diff-info/index";
import { mkNewHighwayNode, NewPoint } from "@/scripts/algo/highway-node";
import { IWay } from "@/scripts/clients";
import { DOMImplementation, XMLSerializer } from "@xmldom/xmldom";
import * as OsmDiff from "@/scripts/ts-xml-object-parser/osm-diff";

const barkersPde = {
  version: "0.6",
  generator: "openstreetmap-cgimap 2.1.0 (1921396 faffy.openstreetmap.org)",
  copyright: "OpenStreetMap and contributors",
  attribution: "http://www.openstreetmap.org/copyright",
  license: "http://opendatacommons.org/licenses/odbl/1-0/",
  elements: [
    {
      type: "way",
      id: 4306563790,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
      nodes: [
        4352740557, 4352742893, 4352740599, 4352742065, 4352740556, 4352736893,
        4352736894, 4352736895, 4352736896, 4352736897, 4352740555, 4352736869,
      ],
      tags: {
        highway: "residential",
        name: "Baker Parade",
        surface: "paved",
      },
    },
    {
      type: "node",
      id: 4352740557,
      lat: -37.860218,
      lon: 145.0824419,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
    {
      type: "node",
      id: 4352742893,
      lat: -37.8602325,
      lon: 145.0825836,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
      tags: {
        crossing: "unmarked",
        highway: "crossing",
      },
    },
    {
      type: "node",
      id: 4352740599,
      lat: -37.8602427,
      lon: 145.0826545,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
    {
      type: "node",
      id: 4352742065,
      lat: -37.8603821,
      lon: 145.0837932,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
    {
      type: "node",
      id: 4352740556,
      lat: -37.8604606,
      lon: 145.0844335,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
    {
      type: "node",
      id: 4352736893,
      lat: -37.8604618,
      lon: 145.084465,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
    {
      type: "node",
      id: 4352736894,
      lat: -37.8604576,
      lon: 145.084514,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
    {
      type: "node",
      id: 4352736895,
      lat: -37.8603949,
      lon: 145.0849847,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
    {
      type: "node",
      id: 4352736896,
      lat: -37.8603925,
      lon: 145.0850209,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
    {
      type: "node",
      id: 4352736897,
      lat: -37.8603928,
      lon: 145.085067,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
    {
      type: "node",
      id: 4352740555,
      lat: -37.8603941,
      lon: 145.0851003,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
    {
      type: "node",
      id: 4352736869,
      lat: -37.8607327,
      lon: 145.0880551,
      timestamp: "2024-12-26T09:22:39Z",
      version: 1,
      changeset: 396710,
      user: "ParticulateMatter",
      uid: 21296,
    },
  ],
};

const sum = (a: number, b: number) => a + b;

test("modal notes - barkers pde", () => {
  const intersections: PartialRecord<WayId, IntersectingWayInfo> = {};
  const wayCentreline: GeoJSON.LineString = {
    type: "LineString",
    coordinates: barkersPde.elements[0]!.nodes!.map((ele) => {
      const node = barkersPde.elements.find(
        (f) => f.type === "node" && f.id === ele
      )!;
      const coordinates: GeoJSON.Position = [node.lon!, node.lat!];
      return coordinates;
    }),
  };
  const wayCentrelineFeature: GeoJSON.Feature<GeoJSON.LineString, IWay> = {
    type: "Feature",
    geometry: wayCentreline,
    properties: barkersPde.elements[0]! as unknown as IWay,
    id: "4306563790",
  };
  const wayCentrelines = { "4306563790": wayCentrelineFeature };
  const relativePoint = [145.0824623114339, -37.86022008867901];
  const highwayPoint = mkNewHighwayNode(
    "4306563790",
    wayCentrelines,
    relativePoint
  );
  const expectedPoint: NewPoint = {
    type: "new",
    way: "4306563790",
    point: {
      type: "Feature",
      properties: {
        dist: 1.793882523331963e-9,
        location: 0.0018068996873699993,
        triggeringWayId: "4306563790",
        segmentWayId: "4306563790",
        index: 0,
      },
      geometry: {
        type: "Point",
        coordinates: [145.08246231141365, -37.86022008867677],
      },
      id: "derived-4306563790",
    },
  };
  expect(highwayPoint).toStrictEqual(expectedPoint);
  const addStopSign: StopSignChange = {
    type: "add stop sign",
    tappedLocation: null,
    highwayLocation: {
      way: "4306563790",
      point: expectedPoint.point,
      type: "new",
    },
    direction: "forward",
    selectedWays: ["4306563790"],
  };
  const selectedWays = [wayCentrelineFeature];
  const notes = ModalNotes.modalNotes(intersections, addStopSign, selectedWays);
  const expectedNotes = {
    changesOld: [
      {
        object: {
          type: "node",
          position: [145.08246231141365, -37.86022008867677],
          node_id: "new-4306563790",
        },
        set_tags: { highway: "stop", direction: "forward" },
      },
      {
        object: {
          type: "way",
          way_id: "4306563790",
          nodes: [
            "4352740557",
            "new-4306563790",
            "4352742893",
            "4352740599",
            "4352742065",
            "4352740556",
            "4352736893",
            "4352736894",
            "4352736895",
            "4352736896",
            "4352736897",
            "4352740555",
            "4352736869",
          ],
        },
        set_tags: {},
      },
    ],
    notes: [
      "Note: something might be off because a different direction has been inferred than the configured direction",
      "Add a stop sign in its physical location by tapping the map where the sign is.",
      "Adding a new stop line on Baker Parade",
      "You can also add or change existing nodes by tapping them: independent traffic signs are shown, as well as give way lines that might need to be corrected.",
    ],
    commentary: ["Add Stop", "On Baker Parade"],
    signFaceAngle: undefined,
    osmChange: {
      version: "0.6",
      generator: "cosm/2025.09.30 (android)",
      create: [
        {
          tag: "node",
          id: 4306563790,
          changeset: 7,
          lon: 145.08246231141365,
          lat: -37.86022008867677,
          tags: { highway: "stop", direction: "forward" },
        },
      ],
      modify: [],
      delete: [],
    },
  };
  //expect(notes).toStrictEqual(expectedNotes) /* still being worked on */
  console.log(buildOsmChangeXML(notes.osmChange));
});

export function buildOsmChangeXML(body: OsmDiff.OsmChange): string {
  const domImpl = new DOMImplementation();
  const doc = domImpl.createDocument(null, "osmChange");

  OsmDiff.buildOsmChangeXML(doc, body);
  return new XMLSerializer().serializeToString(doc);
}
