import { useDebouncedCallback } from "use-debounce";
import fromAsync from "array-from-async";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { InteractionManager } from "react-native";
import * as OsmApiJSON from "@/scripts/clients";
import {
  doublePad,
  InterestingNodes,
  InterestingNodesParams,
  IntersectingWayInfo,
  JsonBBox,
  nub,
  PartialRecord,
  SavedChangeSet,
  TargetNode,
  WayId,
} from "@/components/types";
import {
  initialMutationState,
  initialQueryState,
  MutationState,
  QueryState,
  useDispatchingMutation,
  useDispatchingQuery,
  useMainPageQueries,
} from "@/components/queries";
import type GeoJSON from "geojson";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { NearestPoint, StopSignChange } from "@/components/diff-info";
import { Change } from "@/components/diff-info/shared";
import { mkNewHighwayNode, NewPoint } from "@/scripts/algo/highway-node";
import { IWay } from "@/scripts/clients";
import useOsmPopulator from "@/components/useOsmPopulator";
import useOsmData, {
  WaysInfo,
  MAX_FEATURES_QUERY,
} from "@/components/useOsmData";
import { Promise_never } from "@/components/utils";

// --- Utility functions ---

// noinspection JSUnusedLocalSymbols
const unusedKnownType = function (something: unknown): void {};
export const unusedButOkay = (never: never): undefined => undefined;
const verifyObjIsMemberOf = function <T = never>(val: T) {
  return val;
};

// --- Type guards ---

const isStringRecord = (obj: object): obj is Record<string, string> => {
  return !Object.getOwnPropertyNames(obj).some(
    (prop) =>
      typeof (prop as unknown) !== "string" ||
      typeof (obj as any)[prop] !== "string",
  );
};

const isPoint = (point: unknown): point is GeoJSON.Point => {
  if (!point || typeof point !== "object") return false;
  if (!("type" in point) || point.type !== "Point") return false;
  const coordinates = "coordinates" in point && point.coordinates;
  if (
    !coordinates ||
    typeof coordinates !== "object" ||
    !(coordinates instanceof Array)
  )
    return false;
  if (coordinates.length < 2 || coordinates.length > 3) return false;
  if (coordinates.some((s) => typeof s !== "number")) return false;
  verifyObjIsMemberOf<GeoJSON.Point>({ type: point.type, coordinates });
  return true;
};

const isNearestPoint = (point: object): point is NearestPoint => {
  console.log(point, 1);
  if (!point || typeof point !== "object") return false;
  console.log(point, 2);
  if (!("type" in point) || point.type !== "Feature") return false;
  console.log(point, 3);
  if (!("geometry" in point) || !isPoint(point.geometry)) return false;
  console.log(point, 4);
  if (!("properties" in point)) return false;
  console.log(point, 5);
  const properties = point.properties;
  console.log(point, 6);
  if (!properties || typeof properties !== "object") return false;
  console.log(point, 7);
  if (!("dist" in properties)) return false;
  console.log(point, 8);
  const dist = properties.dist;
  console.log(point, 9);
  if (typeof dist !== "number") return false;
  console.log(point, 10);
  if (!("index" in properties) || typeof properties.index !== "number")
    return false;
  console.log(point, 11);
  const index = properties.index;
  console.log(point, 12);
  if (typeof index !== "number") return false;
  console.log(point, 13);
  if (!("location" in properties) || typeof properties.location !== "number")
    return false;
  console.log(point, 14);
  const location = properties.location;
  console.log(point, 15);
  if (typeof location !== "number") return false;
  console.log(point, 15);
  if (
    !("triggeringWayId" in properties) ||
    (typeof properties.triggeringWayId !== "number" &&
      typeof properties.triggeringWayId !== "string")
  )
    return false;
  console.log(point, 16);
  const triggeringWayId = properties.triggeringWayId;
  console.log(point, 17);
  if (typeof triggeringWayId !== "string") return false;
  console.log(point, 18);
  if (
    !("segmentWayId" in properties) ||
    (typeof properties.segmentWayId !== "number" &&
      typeof properties.segmentWayId !== "string")
  )
    return false;
  console.log(point, 19);
  const segmentWayId = properties.segmentWayId;
  console.log(point, 20);
  if (typeof segmentWayId !== "string") return false;
  console.log(point, 21);

  verifyObjIsMemberOf<NearestPoint>({
    type: point.type,
    geometry: point.geometry,
    properties: { dist, index, location, triggeringWayId, segmentWayId },
  });
  console.log(point, 22);
  return true;
};

const isNewHighwayLocation = (
  obj: object,
): obj is { point: NearestPoint; way: WayId; type: "new" } => {
  const way = "way" in obj && obj.way;
  console.log(1);
  if (typeof way !== "string") return false;
  console.log(2);
  const point =
    "point" in obj && !!obj.point && isNearestPoint(obj.point) && obj.point;
  if (!point) return false;
  console.log(4);
  const type = "type" in obj && obj.type;
  console.log(5);
  if (type !== "new") return false;
  console.log(6);
  verifyObjIsMemberOf<{ point: NearestPoint; way: WayId; type: "new" }>({
    point,
    way,
    type,
  });
  console.log(7);
  return true;
};
const isNewTappedLocation = (
  obj: object,
): obj is { newId: `new-${number}`; point: GeoJSON.Point; type: "new" } => {
  const type = "type" in obj && obj.type;
  if (type !== "new") return false;
  const newId = "newId" in obj && obj.newId;
  if (typeof newId !== "string") return false;
  const prefix = newId.substring(0, 4);
  const suffix = newId.substring(4);
  const suffixNum = +suffix;
  if (prefix !== "new-") return false;
  if (suffixNum.toString() !== suffix) return false;
  const point =
    "point" in obj && !!obj.point && isPoint(obj.point) && obj.point;
  if (!point) return false;
  verifyObjIsMemberOf<{
    newId: `new-${number}`;
    point: GeoJSON.Point;
    type: "new";
  }>({
    newId: `new-${suffixNum}`,
    point,
    type,
  });
  return true;
};
const isINode = (obj: object): obj is OsmApiJSON.INode => {
  const type = "type" in obj && obj.type;
  if (type !== "node") return false;
  const uid = "uid" in obj && obj.uid;
  if (typeof uid !== "number") return false;
  const user = "user" in obj && obj.user;
  if (typeof user !== "string") return false;
  const changeset = "changeset" in obj && obj.changeset;
  if (typeof changeset !== "number") return false;
  const version = "version" in obj && obj.version;
  if (typeof version !== "number") return false;
  const id = "id" in obj && obj.id;
  if (typeof id !== "number") return false;
  const lat = "lat" in obj && obj.lat;
  if (typeof lat !== "number") return false;
  const lon = "lon" in obj && obj.lon;
  if (typeof lon !== "number") return false;
  const timestamp = "timestamp" in obj && obj.timestamp;
  if (typeof timestamp !== "string") return false;
  const tags = "tags" in obj && obj.tags;
  const c: OsmApiJSON.INode = {
    type,
    id,
    lat,
    lon,
    timestamp,
    version,
    changeset,
    user,
    uid,
  };

  if (tags) {
    if (isStringRecord(tags)) c.tags = tags;
    else return false;
  }

  return true;
};
const isTargetNode = (obj: object): obj is TargetNode => {
  const type = "type" in obj && obj.type;
  if (type !== "Feature") return false;

  const geometry =
    "geometry" in obj &&
    !!obj.geometry &&
    isPoint(obj.geometry) &&
    obj.geometry;
  if (!geometry) return false;

  const properties =
    "properties" in obj &&
    !!obj.properties &&
    isINode(obj.properties) &&
    obj.properties;
  if (!properties) return false;
  const isWays = (obj: object): obj is { ways: string[] } => {
    if (!("ways" in properties)) return false;
    if (!(properties.ways instanceof Array)) return false;
    return !properties.ways.some((a) => typeof a !== "string");
  };
  if (!isWays(properties)) return false;

  verifyObjIsMemberOf<TargetNode>({ type, properties, geometry });
  return true;
};

const verifyAsStopSign = (
  change: unknown,
): State["modes"]["addStopSign"]["change"] | undefined => {
  const fail = (msg: string) => {
    throw msg;
  };
  try {
    if (!change || typeof change !== "object") return undefined;
    const type =
      "type" in change && change.type === "add stop sign"
        ? ("add stop sign" as const)
        : fail("type was wrong");
    const direction =
      "direction" in change
        ? change.direction === undefined ||
          change.direction === "forward" ||
          change.direction === "backward"
          ? change.direction
          : fail("direction was wrong")
        : undefined;
    const selectedWays =
      "selectedWays" in change &&
      change.selectedWays instanceof Array &&
      !change.selectedWays.some((s) => typeof s !== "string")
        ? change.selectedWays
        : fail("selected ways was wrong");
    const tappedLocation =
      "tappedLocation" in change &&
      (change.tappedLocation === null ||
        typeof change.tappedLocation === "object")
        ? change.tappedLocation === null ||
          isNewTappedLocation(change.tappedLocation) ||
          isTargetNode(change.tappedLocation)
          ? change.tappedLocation
          : fail("tapped loc 2")
        : fail("tapped location was wrong");
    const highwayLocation =
      "highwayLocation" in change &&
      (change.highwayLocation === null ||
        typeof change.highwayLocation === "object")
        ? change.highwayLocation === null ||
          isNewHighwayLocation(change.highwayLocation) ||
          isTargetNode(change.highwayLocation)
          ? change.highwayLocation
          : fail(`highway loc 2  ${JSON.stringify(change.highwayLocation)}`)
        : fail("highway location was wrong");

    return { type, tappedLocation, highwayLocation, direction, selectedWays };
  } catch (e) {
    console.log("could not verify as stop sign", e);
    return undefined;
  }
};

// --- Types ---

export type State = {
  initialSetup: boolean;
  neededForLoading: number | undefined;
  mode: Mode;
  modes: {
    browse: object;
    addStopSign: {
      changeId: number | undefined;
      change: StopSignChange;
    };
  };
  zoom: number;
  centreCoordinates: GeoJSON.Position | undefined;
  visibleBounds:
    | { minlat: number; minlon: number; maxlat: number; maxlon: number }
    | undefined;
  sameRoads_m: PartialRecord<WayId, WayId[]>;
  intersections_m: PartialRecord<WayId, IntersectingWayInfo>;
  queries: {
    queryNodes: QueryState<
      unknown,
      GeoJSON.FeatureCollection<GeoJSON.Point, OsmApiJSON.INode> | null
    >;
    queryWays_: QueryState<
      unknown,
      {
        casings: GeoJSON.FeatureCollection<
          GeoJSON.Polygon | GeoJSON.LineString,
          OsmApiJSON.IWay
        > | null;
        centrelines: GeoJSON.FeatureCollection<
          GeoJSON.LineString,
          OsmApiJSON.IWay
        > | null;
      }
    >;
    interestingNodes: QueryState<unknown, InterestingNodes>;
    osmCapabilities: QueryState<unknown, OsmApiJSON.IApiCapabilities>;
    osmVersions: QueryState<unknown, OsmApiJSON.IInaRecord_api>;
    unknownBounds: QueryState<
      unknown,
      { minlat: number; minlon: number; maxlat: number; maxlon: number } | null
    >;
    neededForLoading: QueryState<unknown, SavedChangeSet | null>;
    saveNewUserDataChanges: MutationState<unknown, SavedChangeSet>;
    saveUpdateUserDataChanges: MutationState<unknown, number>;
  };
};

export type Mode = keyof State["modes"];

type SelectWay = {
  action: "select ways";
  ways: WayId[];
  select: "toggle";
  point: GeoJSON.Position;
};
type SetInitialSetup = { action: "post initial setup" };
type SetZoom = {
  action: "set zoom";
  zoom: number;
  centreCoordinates?: GeoJSON.Position;
};
type SetVisibleBounds = {
  action: "set visible bounds";
  visibleBounds: JsonBBox;
};
type SetQuery<Query extends keyof State["queries"]> = {
  action: "set query";
  query: Query;
  queryState: State["queries"][Query];
};
type SetMode = { action: "set mode"; mode: Mode };
type SelectInterestingPoint = {
  action: "select interesting point";
  point: TargetNode;
};
type ModalAction<M extends Mode> = {
  action: "modal";
  mode: M;
  modalAction: ActionInMode<M>;
};
type ActionInMode<M extends Mode> = M extends "browse"
  ? BrowseAction
  : M extends "addStopSign"
    ? AddStopSignAction
    : never;
type BrowseAction = never;
type AddStopSignAction =
  | SelectInterestingPoint
  | SelectWay
  | ActionAddStopSign
  | ActionUpdateHighwayPoint;
type ActionUpdateHighwayPoint = {
  action: "updated highway location";
  point: GeoJSON.Point;
};
type ActionAddStopSign =
  | { action: "add stop sign"; tappedLocation: null }
  | {
      action: "add stop sign";
      tappedLocation: GeoJSON.Point;
      newId: `new-${number}`;
    };
type NeededForLoading = { action: "needed for loading"; id: number };

export type Action =
  | ModalAction<"browse">
  | ModalAction<"addStopSign">
  | NeededForLoading
  | SetVisibleBounds
  | SetZoom
  | SetInitialSetup
  | SetMode
  | { action: "invalidate same roads" }
  | { action: "invalidate intersections" }
  | { action: "new same roads"; sameRoads: PartialRecord<WayId, WayId[]> }
  | {
      action: "new intersections";
      intersections: PartialRecord<WayId, IntersectingWayInfo>;
    }
  | SetQuery<"unknownBounds">
  | SetQuery<"osmCapabilities">
  | SetQuery<"interestingNodes">
  | SetQuery<"queryNodes">
  | SetQuery<"queryWays_">
  | SetQuery<"osmVersions">
  | SetQuery<"saveNewUserDataChanges">
  | SetQuery<"saveUpdateUserDataChanges">
  | SetQuery<"neededForLoading">;

// --- Initial state ---

const initialState: State = {
  mode: "browse",
  neededForLoading: undefined,
  initialSetup: true,
  modes: {
    browse: {},
    addStopSign: {
      changeId: undefined,
      change: {
        type: "add stop sign",
        tappedLocation: null,
        highwayLocation: null,
        direction: undefined,
        selectedWays: [],
      },
    },
  },
  visibleBounds: undefined,
  zoom: 14,
  centreCoordinates: undefined,
  intersections_m: {},
  sameRoads_m: {},
  queries: {
    neededForLoading: initialQueryState(),
    queryNodes: initialQueryState(),
    queryWays_: initialQueryState(),
    interestingNodes: initialQueryState(),
    unknownBounds: initialQueryState(),
    osmCapabilities: initialQueryState(),
    osmVersions: initialQueryState(),
    saveNewUserDataChanges: initialMutationState(),
    saveUpdateUserDataChanges: initialMutationState(),
  },
};

const ismode = (mode: string): mode is Mode => mode in initialState.modes;

// --- Reducer helpers ---

const make_id = (() => {
  let id = 1;
  return () => id++;
})();

const mkNewHighwayNodeFromState = (
  wayId: WayId,
  state: State,
  relativePoint: GeoJSON.Position | GeoJSON.Point,
): NewPoint | undefined => {
  const wayGroup = state.modes.addStopSign.change.selectedWays.flatMap(
    (w) => state.sameRoads_m[w] || [],
  );
  const waysCentrelines =
    state.queries.queryWays_.data?.centrelines?.features || [];
  const wayCentrelines: Record<
    WayId,
    GeoJSON.Feature<GeoJSON.LineString, IWay>
  > = {};
  wayGroup.forEach((localWayId) => {
    const way = waysCentrelines.find((w) => w.id === localWayId);
    if (!way) return [];
    wayCentrelines[localWayId] = way;
  });
  return mkNewHighwayNode(wayId, wayCentrelines, relativePoint);
};

// --- Reducer ---

const reducer = (state: State, action: Action): State => {
  switch (action.action) {
    case "needed for loading": {
      return { ...state, neededForLoading: action.id };
    }
    case "set mode": {
      switch (action.mode) {
        case "browse":
          return { ...state, mode: action.mode, modes: initialState.modes };
        default:
          return { ...state, mode: action.mode };
      }
    }
    case "modal": {
      switch (action.mode) {
        case "browse": {
          unusedButOkay(action.modalAction);
          return state;
        }
        case "addStopSign": {
          const modalAction = action.modalAction;
          switch (modalAction.action) {
            case "select interesting point": {
              if (
                modalAction.point.properties.ways.length === 0 &&
                modalAction.point.properties.tags?.highway === undefined &&
                !state.modes.addStopSign.change.tappedLocation
              ) {
                return {
                  ...state,
                  modes: {
                    ...state.modes,
                    addStopSign: {
                      ...state.modes.addStopSign,
                      change: {
                        ...state.modes.addStopSign.change,
                        tappedLocation: modalAction.point,
                      },
                    },
                  },
                };
              } else if (modalAction.point.properties.ways.length === 1) {
                if (
                  state.modes.addStopSign.change.highwayLocation &&
                  state.modes.addStopSign.change.highwayLocation.type ===
                    "Feature" &&
                  state.modes.addStopSign.change.highwayLocation.id ===
                    modalAction.point.id
                ) {
                  return {
                    ...state,
                    modes: {
                      ...state.modes,
                      addStopSign: {
                        ...state.modes.addStopSign,
                        change: {
                          ...state.modes.addStopSign.change,
                          highwayLocation: null,
                        },
                      },
                    },
                  };
                } else {
                  return {
                    ...state,
                    modes: {
                      ...state.modes,
                      addStopSign: {
                        ...state.modes.addStopSign,
                        change: {
                          ...state.modes.addStopSign.change,
                          highwayLocation: modalAction.point,
                          selectedWays: [...modalAction.point.properties.ways],
                        },
                      },
                    },
                  };
                }
              } else {
                return state;
              }
            }
            case "select ways": {
              const way = modalAction.ways.length >= 1 && modalAction.ways[0];
              if (!way) return state;

              const isAlreadySelected =
                state.modes.addStopSign.change.selectedWays.includes(way);
              const highwayNodeWays =
                state.modes.addStopSign.change.highwayLocation &&
                ("way" in state.modes.addStopSign.change.highwayLocation
                  ? [state.modes.addStopSign.change.highwayLocation.way]
                  : state.modes.addStopSign.change.highwayLocation.properties
                      .ways);

              if (isAlreadySelected && highwayNodeWays) {
                return {
                  ...state,
                  modes: {
                    ...state.modes,
                    addStopSign: {
                      ...state.modes.addStopSign,
                      change: {
                        ...state.modes.addStopSign.change,
                        highwayLocation: null,
                        selectedWays: [],
                      },
                    },
                  },
                };
              } else {
                const newHighwayNode = mkNewHighwayNodeFromState(
                  way,
                  state,
                  modalAction.point,
                );
                console.log("new higway node", newHighwayNode);
                return {
                  ...state,
                  modes: {
                    ...state.modes,
                    addStopSign: {
                      ...state.modes.addStopSign,
                      change: {
                        ...state.modes.addStopSign.change,
                        highwayLocation: newHighwayNode || null,
                        selectedWays: [way],
                      },
                    },
                  },
                };
              }
            }
            case "add stop sign": {
              return {
                ...state,
                modes: {
                  ...state.modes,
                  addStopSign: {
                    ...state.modes.addStopSign,
                    change: {
                      ...state.modes.addStopSign.change,
                      tappedLocation: modalAction.tappedLocation
                        ? {
                            type: "new",
                            newId: modalAction.newId,
                            point: modalAction.tappedLocation,
                          }
                        : null,
                    },
                  },
                },
              };
            }
            case "updated highway location": {
              const wayId = state.modes.addStopSign.change.selectedWays[0];
              const newHighwayNode = mkNewHighwayNodeFromState(
                wayId,
                state,
                modalAction.point,
              );
              return newHighwayNode === undefined
                ? state
                : {
                    ...state,
                    modes: {
                      ...state.modes,
                      addStopSign: {
                        ...state.modes.addStopSign,
                        change: {
                          ...state.modes.addStopSign.change,
                          highwayLocation: newHighwayNode,
                          selectedWays: [newHighwayNode.way],
                        },
                      },
                    },
                  };
            }
            default: {
              unusedButOkay(modalAction);
              return state;
            }
          }
        }
        default: {
          unusedButOkay(action);
          return state;
        }
      }
    }
    case "new same roads": {
      return { ...state, sameRoads_m: action.sameRoads };
    }
    case "new intersections": {
      return { ...state, intersections_m: action.intersections };
    }
    case "invalidate same roads": {
      return { ...state, sameRoads_m: {} };
    }
    case "invalidate intersections": {
      return { ...state, intersections_m: {} };
    }
    case "post initial setup": {
      return state.initialSetup ? { ...state, initialSetup: false } : state;
    }
    case "set zoom": {
      console.log(action);
      return state.zoom === action.zoom
        ? state
        : {
            ...state,
            zoom: action.zoom,
            centreCoordinates: action.centreCoordinates,
          };
    }
    case "set visible bounds": {
      if (
        !state.visibleBounds ||
        state.visibleBounds.minlat !== action.visibleBounds.minlat ||
        state.visibleBounds.minlon !== action.visibleBounds.minlon ||
        state.visibleBounds.maxlat !== action.visibleBounds.maxlat ||
        state.visibleBounds.maxlon !== action.visibleBounds.maxlon
      ) {
        return { ...state, visibleBounds: action.visibleBounds };
      } else {
        return state;
      }
    }
    case "set query": {
      let updateState = { ...state };
      if (action.queryState.status === "error") {
        console.log("error", action);
      }
      switch (action.query) {
        case "neededForLoading": {
          console.log("needed for loading?", action);
          if (action.queryState.status === "success") {
            const data = action.queryState.data;
            console.log("needed for loading!", data);
            if (data) {
              const type1 = data.type as Mode;
              switch (type1) {
                case "browse":
                  break;
                case "addStopSign": {
                  const id =
                    typeof (data.id as unknown) === "number" && data.id;
                  const state_extract = verifyAsStopSign(data.state_extract);
                  if (id && state_extract) {
                    updateState.modes.addStopSign.changeId = id;
                    updateState.modes.addStopSign.change = state_extract;
                    updateState.mode = "addStopSign";
                  } else {
                    console.log(
                      "we got some error",
                      id,
                      state_extract,
                      data.state_extract,
                    );
                  }
                  break;
                }
              }
            }
            updateState.neededForLoading = undefined;
          }
          break;
        }
        case "saveNewUserDataChanges": {
          const data = action.queryState.data;
          if (action.queryState.status === "success" && data) {
            const type = data.type;
            if (
              ismode(type) &&
              "changeId" in updateState.modes[type] &&
              updateState.modes[type].changeId === undefined
            ) {
              updateState.modes[type].changeId = data.id;
            }
          }
          break;
        }
        case "queryWays_":
          if (
            state.zoom < 20 &&
            action.queryState.status === "success" &&
            action.queryState.fetchStatus === "idle" &&
            action.queryState.data?.casings?.features.length ===
              MAX_FEATURES_QUERY
          ) {
            console.log(
              "because max features",
              action.queryState.data?.casings.features.length,
              "zooming",
              state.zoom + 1,
            );
            updateState = { ...updateState, zoom: Math.floor(state.zoom) + 1 };
          }
          break;
      }
      return {
        ...updateState,
        queries: { ...updateState.queries, [action.query]: action.queryState },
      };
    }
  }
};

// --- State derivation helpers ---

const selectedInterestingPointsForMode = (state: State): string[] => {
  switch (state.mode) {
    case "browse":
      return [];
    case "addStopSign":
      return [
        state.modes.addStopSign.change.tappedLocation?.type === "Feature" &&
          state.modes.addStopSign.change.tappedLocation.id?.toString(),
        state.modes.addStopSign.change.highwayLocation &&
          state.modes.addStopSign.change.highwayLocation.type === "Feature" &&
          state.modes.addStopSign.change.highwayLocation.id?.toString(),
      ].flatMap((m) => (m ? [m] : []));
  }
};

const interestingNodesParamsFromMode = (
  state: State,
):
  | undefined
  | Omit<InterestingNodesParams, "minlon" | "minlat" | "maxlon" | "maxlat"> => {
  switch (state.mode) {
    case "browse":
      return undefined;
    case "addStopSign":
      return {
        $needles: [
          { highway: "stop" },
          { traffic_sign: "stop" },
          { highway: "give_way" },
          { highway: "giveway" },
        ],
      };
  }
};

const currentModesSelectedWays = (state: State): WayId[] => {
  switch (state.mode) {
    case "browse":
      return [];
    case "addStopSign":
      return state.modes.addStopSign.change.selectedWays;
    default:
      unusedButOkay(state.mode);
      return [];
  }
};
const allModesSelectedWays = (state: State): WayId[] => {
  return Object.keys(state.modes).flatMap((k) => {
    const t: keyof State["modes"] = k as keyof State["modes"];
    switch (t) {
      case "addStopSign": {
        return state.modes.addStopSign.change.selectedWays;
      }
      case "browse":
        return [];
      default:
        unusedButOkay(t);
        return [];
    }
  });
};
const anyModeSelectsWay = (state: State, wayId: WayId) => {
  return Object.keys(state.modes).some((k) => {
    const t: keyof State["modes"] = k as keyof State["modes"];
    switch (t) {
      case "addStopSign": {
        return state.modes.addStopSign.change.selectedWays.includes(wayId);
      }
      case "browse": {
        return false;
      }
      default:
        unusedButOkay(t);
        return false;
    }
  });
};

// --- MyChangeSet type ---

type MyChangeSet_<
  M extends Mode,
  Y,
  X extends State["modes"][M] & { change: Y },
> = {
  type: M;
  change: Change[];
  state_extract: X["change"];
};
type MyChangeSet = MyChangeSet_<
  "addStopSign",
  State["modes"]["addStopSign"]["change"],
  State["modes"]["addStopSign"]
>;

// --- The hook ---

export function useMainPageState() {
  const params = useLocalSearchParams<{ id?: string }>();
  const queryClient = useQueryClient();
  const queries = useMainPageQueries();
  const [state, dispatch] = useReducer(reducer, initialState);

  console.log(
    "params",
    params,
    state.neededForLoading,
    state.queries.neededForLoading,
    state.modes.addStopSign,
    state.mode,
  );

  useEffect(() => {
    const idstr = params.id as unknown;
    if (!idstr || typeof idstr !== "string") return;
    try {
      const id = JSON.parse(idstr) as unknown;
      console.log("going to run with id", id);
      if (typeof id !== "number") return;
      dispatch({ action: "needed for loading", id });
    } catch (e) {
      unusedKnownType(e);
      return;
    }
  }, [params.id, dispatch]);

  /* simple synonyms */
  const visibleBounds = state.visibleBounds;
  const doublePaddedBounds = visibleBounds && doublePad(visibleBounds);

  const interestingPoints = state.queries.interestingNodes.data;

  const mapArea = visibleBounds
    ? (visibleBounds.maxlon - visibleBounds.minlon) *
      (visibleBounds.maxlat - visibleBounds.minlat)
    : undefined;
  const capability = state.queries.osmCapabilities.data?.api.area.maximum;
  const osmMapArgs: JsonBBox | undefined =
    state.queries.unknownBounds.data || visibleBounds;
  const invalidateSameRoads = useCallback(
    () => dispatch({ action: "invalidate same roads" }),
    [],
  );
  useOsmPopulator(
    osmMapArgs,
    state.queries.unknownBounds.status === "success" &&
      !!state.queries.unknownBounds.data,
    invalidateSameRoads,
    InteractionManager.runAfterInteractions,
  );
  const withNewWays = useCallback(
    (ways: QueryState<unknown, WaysInfo>) =>
      dispatch({ action: "set query", query: "queryWays_", queryState: ways }),
    [],
  );
  const setIntersections = useCallback(
    (intersections: PartialRecord<WayId, IntersectingWayInfo>) =>
      dispatch({ action: "new intersections", intersections }),
    [],
  );
  const setSameRoads = useCallback(
    (sameRoads: PartialRecord<WayId, WayId[]>) =>
      dispatch({ action: "new same roads", sameRoads }),
    [],
  );
  const allModeSelectedWays_ = allModesSelectedWays(state);
  const isWaySelected = (wayId: WayId) => anyModeSelectsWay(state, wayId);
  useOsmData({
    loadingBounds: doublePaddedBounds,
    interestingWays: allModeSelectedWays_,
    withNewWays,
    isWaySelected,
    setSameRoads,
    setIntersections,
    intersections: state.intersections_m,
    sameRoads: state.sameRoads_m,
  });
  const symbols = state.queries.queryNodes.data || null;
  const roadcasings = state.queries.queryWays_.data?.casings || null;

  const modalSelectedWays = currentModesSelectedWays(state);
  const highlightWays = useMemo(
    () =>
      nub(
        modalSelectedWays.concat(
          modalSelectedWays.flatMap((f) => state.sameRoads_m[f] || []),
        ),
      ),
    [modalSelectedWays, state.sameRoads_m],
  );

  const interestingNodesParams =
    doublePaddedBounds &&
    (() => {
      const params = interestingNodesParamsFromMode(state);
      return params && { ...params, ...doublePaddedBounds };
    })();
  const hasInterestingNodes = !!interestingNodesParams;

  /* queries */
  useDispatchingQuery(
    useCallback(
      (queryState: QueryState<unknown, InterestingNodes>) =>
        dispatch({
          action: "set query",
          query: "interestingNodes",
          queryState,
        }),
      [],
    ),
    {
      queryKey: ["spatialite", "nearby ways", interestingNodesParams],
      enabled: hasInterestingNodes,
      placeholderData: (data) => data,
      queryFn: interestingNodesParams
        ? () => queries.current.doFindTargetNodes(interestingNodesParams)
        : () => new Promise(() => {}),
    },
  );

  useDispatchingQuery(
    useCallback(
      (queryState: QueryState<unknown, JsonBBox | null>) =>
        dispatch({
          action: "set query",
          query: "unknownBounds",
          queryState,
        }),
      [],
    ),
    {
      queryKey: ["spatialite known bounds", visibleBounds],
      enabled:
        !!mapArea &&
        !!capability &&
        !!visibleBounds &&
        mapArea * 10 <= capability,
      queryFn: visibleBounds
        ? async () => {
            console.log("mew, mew");
            const result = await queries.current.doKnownBounds(visibleBounds);
            if (result && result.bbox) {
              const [minlon, minlat, maxlon, maxlat] = result.bbox;
              return { minlon, minlat, maxlon, maxlat };
            } else {
              return null;
            }
          }
        : skipToken,
    },
  );

  useDispatchingQuery(
    useCallback(
      (
        queryState: QueryState<
          unknown,
          GeoJSON.FeatureCollection<GeoJSON.Point, OsmApiJSON.INode> | null
        >,
      ) =>
        dispatch({
          action: "set query",
          query: "queryNodes",
          queryState,
        }),
      [],
    ),
    {
      queryKey: ["spatialite query nodes", doublePaddedBounds || {}],
      enabled: !!doublePaddedBounds,
      queryFn: async (): Promise<GeoJSON.FeatureCollection<
        GeoJSON.Point,
        OsmApiJSON.INode
      > | null> => {
        if (!doublePaddedBounds) return await Promise_never();
        const nodes = await fromAsync(
          queries.current.doQueryNodes(doublePaddedBounds),
        );
        return nodes.length
          ? { type: "FeatureCollection", features: nodes }
          : null;
      },
    },
  );

  useDispatchingQuery(
    useCallback(
      (queryState: QueryState<unknown, OsmApiJSON.IInaRecord_api>) =>
        dispatch({
          action: "set query",
          query: "osmVersions",
          queryState,
        }),
      [],
    ),
    {
      queryKey: ["osm query version"],
      queryFn: OsmApiJSON.getApiVersions,
      staleTime: 7 * 24 * 60 * 60 * 1000,
      placeholderData: (prev) =>
        prev || { api: { versions: ["0.6" as const] } },
    },
  );

  const neededForLoading = state.neededForLoading;
  useDispatchingQuery(
    useCallback(
      (queryState: QueryState<unknown, SavedChangeSet | null>) =>
        dispatch({
          action: "set query",
          query: "neededForLoading",
          queryState,
        }),
      [],
    ),
    {
      queryKey: ["spatialite", "needed for loading", neededForLoading],
      enabled: !!neededForLoading,
      queryFn: neededForLoading
        ? () => queries.current.doselectUserChange(neededForLoading)
        : skipToken,
    },
  );

  useDispatchingQuery(
    useCallback(
      (queryState: QueryState<unknown, OsmApiJSON.IApiCapabilities>) =>
        dispatch({
          action: "set query",
          query: "osmCapabilities",
          queryState,
        }),
      [],
    ),
    {
      queryKey: ["osm query capabilities", state.queries.osmVersions.data],
      enabled:
        state.queries.osmVersions.status === "success" &&
        state.queries.osmVersions.data.api.versions.includes("0.6"),
      queryFn: OsmApiJSON.getApi06Capabilities,
      staleTime: 7 * 24 * 60 * 60 * 1000,
      placeholderData: (prev) =>
        prev || {
          api: {
            version: { minimum: "0.6" as const, maximum: "0.6" as const },
            area: { maximum: 0.125 },
            note_area: { maximum: 1 },
            tracepoints: { per_page: 0 },
            waynodes: { maximum: 100 },
            relationmembers: { maximum: 100 },
            changesets: {
              maximum_elements: 8,
              default_query_limit: 10,
              maximum_query_limit: 10,
            },
            notes: { default_query_limit: 10, maximum_query_limit: 10 },
            timeout: { seconds: 100 },
            status: {
              database: "offline" as const,
              api: "offline" as const,
              gpx: "offline" as const,
            },
          },
          policy: { imagery: { blacklist: [] } },
        },
    },
  );
  const [changes, setChanges] = useState<Change[]>([]);
  const [commentary, setCommentary] = useState<[string, string | undefined]>([
    "Browse",
    undefined,
  ]);
  const [notes, setNotes] = useState<string[]>([]);

  /* mutations */
  const qSaveUpdateUserChanges = useDispatchingMutation(
    useCallback(
      (queryState: MutationState<unknown, number>) =>
        dispatch({
          action: "set query",
          query: "saveUpdateUserDataChanges",
          queryState,
        }),
      [],
    ),
    {
      mutationFn: ({
        id,
        args,
        commentary,
      }: {
        id: number;
        args: MyChangeSet;
        commentary: [string, string | undefined];
      }) => queries.current.doSaveUpdateChange(id, args, commentary),
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["spatialite", "needed for loading"],
        });
      },
    },
  );
  const debSaveUpdateUserChanges = useDebouncedCallback(
    (args: {
      id: number;
      args: MyChangeSet;
      commentary: [string, string | undefined];
    }) => {
      console.log("the debouncee has been triggered", args);
      qSaveUpdateUserChanges.mutate(args);
    },
    250,
    { maxWait: 10_000 },
  );

  const modeSettings = state.modes[state.mode];
  useEffect(() => {
    if (
      "changeId" in modeSettings &&
      typeof modeSettings.changeId === "number" &&
      state.mode !== "browse"
    ) {
      console.log(
        "we have further got enough data to save",
        modeSettings.changeId,
      );
      debSaveUpdateUserChanges({
        commentary,
        id: modeSettings.changeId,
        args: {
          type: state.mode,
          change: changes,
          state_extract: modeSettings.change,
        },
      });
    }
  }, [state.mode, modeSettings, changes, debSaveUpdateUserChanges, commentary]);

  const qSaveNewUserChanges = useDispatchingMutation(
    useCallback(
      (queryState: MutationState<unknown, SavedChangeSet>) =>
        dispatch({
          action: "set query",
          query: "saveNewUserDataChanges",
          queryState,
        }),
      [],
    ),
    {
      mutationFn: (args: MyChangeSet) => queries.current.doSaveNewChange(args),
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["spatialite", "needed for loading"],
        });
      },
    },
  );

  const modeHasChanges =
    "changeId" in modeSettings ? modeSettings.changeId : null;
  const qSaveNewUserChangesMutate = qSaveNewUserChanges.mutate;
  useEffect(() => {
    if (
      "changeId" in modeSettings &&
      modeSettings.changeId === undefined &&
      state.mode !== "browse"
    ) {
      qSaveNewUserChangesMutate({
        type: state.mode,
        change: changes,
        state_extract: modeSettings.change,
      });
    }
  }, [
    state.mode,
    modeSettings,
    changes,
    modeHasChanges,
    qSaveNewUserChangesMutate,
  ]);

  /* callbacks */
  const setTappedLocation = useCallback(
    (tappedLocation: GeoJSON.Point | null, toggle = false) => {
      switch (state.mode) {
        case "addStopSign":
          const oldLoc =
            toggle && state.modes.addStopSign.change.tappedLocation
              ? null
              : state.modes.addStopSign.change.tappedLocation;
          const loc =
            toggle && state.modes.addStopSign.change.tappedLocation
              ? null
              : tappedLocation;
          return dispatch({
            action: "modal",
            mode: "addStopSign",
            modalAction: loc
              ? {
                  action: "add stop sign",
                  tappedLocation: loc,
                  newId:
                    oldLoc && oldLoc.type === "new"
                      ? oldLoc.newId
                      : `new-${make_id()}`,
                }
              : { action: "add stop sign", tappedLocation: loc },
          });
        case "browse":
          return;
        default:
          unusedButOkay(state.mode);
          return;
      }
    },
    [state.mode, state.modes.addStopSign.change.tappedLocation],
  );

  useEffect(() => {
    setTimeout(() => {
      dispatch({
        action: "set zoom",
        centreCoordinates: [145.0825836, -37.8602325],
        zoom: 16,
      });
    }, 300);
  }, []);

  useEffect(() => {
    setTimeout(() => {
      dispatch({ action: "post initial setup" });
    }, 30_000);
  }, []);

  const selectedInterestingPoints = selectedInterestingPointsForMode(state);

  return {
    state,
    dispatch,
    visibleBounds,
    doublePaddedBounds,
    interestingPoints,
    symbols,
    roadcasings,
    highlightWays,
    selectedInterestingPoints,
    setTappedLocation,
    changes,
    setChanges,
    commentary,
    setCommentary,
    notes,
    setNotes,
    debSaveUpdateIsPending: debSaveUpdateUserChanges.isPending(),
  };
}
