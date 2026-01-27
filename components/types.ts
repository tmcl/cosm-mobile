import type GeoJSON from "geojson";
import * as OsmApi from "@/scripts/clients";

export type TargetNode = GeoJSON.Feature<
  GeoJSON.Point,
  { ways: string[] } & OsmApi.INode
>;

export type InterestingNodes = GeoJSON.FeatureCollection<GeoJSON.Point, object>;
export type InterestingNodesParams = {
  $needles: Record<string, string>[];
  minlon: number;
  minlat: number;
  maxlon: number;
  maxlat: number;
};

export type SavedChangeSet<JSON = object> = {
  id: number;
  type: string;
  state_extract: JSON;
  change: JSON;
  created_date: number;
  modified_date: number | null;
  ready_date: number | null;
  commit_date: number | null;
  commentary1: string | null;
  commentary2: string | null;
};
export type ChangeSet = {
  type: string;
  state_extract: object;
  change: object;
};

export type JsonBBox = {
  minlon: number;
  minlat: number;
  maxlat: number;
  maxlon: number;
};

export type IntersectingWayInfo = {
  ix: number;
  node_tags: OsmApi.INode;
  others: WayId<number>;
  way_tags: OsmApi.IWay;
}[];

export function doublePad(bbox: JsonBBox): JsonBBox;
export function doublePad({
  minlon,
  minlat,
  maxlon,
  maxlat,
}: JsonBBox): JsonBBox {
  minlon = minlon - (maxlon - minlon);
  maxlon = maxlon + (maxlon - minlon);
  minlat = minlat - (maxlat - minlat);
  maxlat = maxlat + (maxlat - minlat);
  return { minlon, minlat, maxlon, maxlat };
}

export type FoundNearbyWays = { ways: WayId[]; nodes: GeoJSON.Point[] };

export const debug = <A, B>(a: A, b: B): B => {
  console.log(a, b);
  return b;
};
export type WayId<T extends string | number = string> = T;

export const nub = (arr: string[]): string[] => {
  return Object.keys(Object.fromEntries(arr.map((f) => [f, true])));
};

export const bound = (val: number, min: number, max: number) => {
  const difference = max - min;
  let result = val;
  while (result < min) {
    result += difference;
  }
  while (result >= max) {
    result -= difference;
  }
  return result;
};

// like a memoizer, but only evaluated once.
export const lazy = <T>(f: () => T): (() => T) => {
  let result: undefined | T;
  return () => result || (result = f());
};

export type PartialRecord<A extends string | number | symbol, B> = Partial<
  Record<A, B>
>;
export const unreachable = (x: never): never => {
  throw new Error(x);
};
