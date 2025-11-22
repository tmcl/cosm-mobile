import type GeoJSON from "geojson";
import {PartialRecord} from "@/components/types";

export type OsmObject =
    { type: "way", way_id: `${number}`, nodes?: string[] }
    | { type: "way", way_id: `new-${number}`, nodes: string[] }
    | { type: "node", node_id: `${number}`, position?: GeoJSON.Position }
    | { type: "node", node_id: `new-${number}`, position: GeoJSON.Position }

export type Change = { object: OsmObject, set_tags: PartialRecord<string, string> }
