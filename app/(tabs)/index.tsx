import {useDebouncedCallback} from "use-debounce"
import fromAsync from 'array-from-async';
import React, {useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react'
import {FAB} from '@rneui/themed'
import {InteractionManager, StyleSheet, Text, View} from "react-native";
import MapLibreGL from '@maplibre/maplibre-react-native';
import * as OsmApiJSON from "@/scripts/clients";
import {useAndroidLocationPermission} from '@/components/AndroidLocationPermission';
import {
  debug,
  doublePad,
  InterestingNodes,
  InterestingNodesParams,
  IntersectingWayInfo,
  JsonBBox,
  nub,
  PartialRecord,
  SavedChangeSet,
  TargetNode,
  WayId
} from '@/components/types';
import {
  initialMutationState,
  initialQueryState,
  MutationState,
  QueryState,
  useDispatchingMutation,
  useDispatchingQuery,
  useMainPageQueries,
} from '@/components/queries';
import type GeoJSON from "geojson";
import {skipToken, useQueryClient} from '@tanstack/react-query'
import * as Svg from "react-native-svg";
import {IconNode} from "@rneui/base";
import {useLocalSearchParams} from "expo-router";
import * as ExLoc from 'expo-location'
import {CircleLayer} from "@maplibre/maplibre-react-native";
import {modalNotes, NearestPoint, StopSignChange} from "@/components/diff-info";
import {Change} from "@/components/diff-info/shared";
import {mkNewHighwayNode, NewPoint} from "@/scripts/algo/highway-node";
import {IWay} from "@/scripts/clients";
import useOsmPopulator, {MAX_FEATURES_QUERY} from "@/components/useOsmPopulator";

interface OnPressEvent {
  features: GeoJSON.Feature[];
  coordinates: {
    latitude: number; longitude: number;
  };
  point: {
    x: number; y: number;
  };
}

const LayerIndexLookup = {
  roadcasingfill: 103, roadcasinglines: 104, points: 106, pointsOnWayNearClicks: 107, nearestPointLayer: 108,
}

const isStringRecord = (obj: object): obj is Record<string, string> => {
  return !Object.getOwnPropertyNames(obj)
  .some(prop => typeof (prop as unknown) !== "string" || typeof (obj as any)[prop] !== "string")
}

const isPoint = (point: unknown): point is GeoJSON.Point => {
  if (!point || typeof point !== "object") return false
  if (!("type" in point) || point.type !== "Point") return false
  const coordinates = "coordinates" in point && point.coordinates
  if (!coordinates || typeof coordinates !== "object" || !(coordinates instanceof Array)) return false
  if (coordinates.length < 2 || coordinates.length > 3) return false
  if (coordinates.some(s => typeof s !== 'number')) return false
  verifyObjIsMemberOf<GeoJSON.Point>({type: point.type, coordinates})
  return true
}

const isNearestPoint = (point: object): point is NearestPoint => {
  console.log(point, 1)
  if (!point || typeof point !== "object") return false
  console.log(point, 2)
  if (!("type" in point) || point.type !== "Feature") return false
  console.log(point, 3)
  if (!("geometry" in point) || !isPoint(point.geometry)) return false
  console.log(point, 4)
  if (!("properties" in point)) return false
  console.log(point, 5)
  const properties = point.properties
  console.log(point, 6)
  if (!properties || typeof properties !== "object") return false
  console.log(point, 7)
  if (!("dist" in properties)) return false
  console.log(point, 8)
  const dist = properties.dist
  console.log(point, 9)
  if (typeof dist !== "number") return false
  console.log(point, 10)
  if (!("index" in properties) || typeof properties.index !== "number") return false
  console.log(point, 11)
  const index = properties.index
  console.log(point, 12)
  if (typeof index !== "number") return false
  console.log(point, 13)
  if (!("location" in properties) || typeof properties.location !== "number") return false
  console.log(point, 14)
  const location = properties.location
  console.log(point, 15)
  if (typeof location !== "number") return false
  console.log(point, 15)
  if (!("triggeringWayId" in properties) || (typeof properties.triggeringWayId
      !== "number"
      && typeof properties.triggeringWayId
      !== "string")) return false
  console.log(point, 16)
  const triggeringWayId = properties.triggeringWayId
  console.log(point, 17)
  if (typeof triggeringWayId !== "string") return false
  console.log(point, 18)
  if (!("segmentWayId" in properties) || (typeof properties.segmentWayId
      !== "number"
      && typeof properties.segmentWayId
      !== "string")) return false
  console.log(point, 19)
  const segmentWayId = properties.segmentWayId
  console.log(point, 20)
  if (typeof segmentWayId !== "string") return false
  console.log(point, 21)

  verifyObjIsMemberOf<NearestPoint>({
    type: point.type,
    geometry: point.geometry,
    properties: {dist, index, location, triggeringWayId, segmentWayId}
  })
  console.log(point, 22)
  return true
}

const isNewHighwayLocation = (obj: object): obj is { point: NearestPoint, way: WayId, type: "new" } => {
  const way = "way" in obj && obj.way
  console.log(1)
  if (typeof way !== "string") return false;
  console.log(2)
  const point = "point" in obj && !!obj.point && isNearestPoint(obj.point) && obj.point
  if (!point) return false
  console.log(4)
  const type = "type" in obj && obj.type
  console.log(5)
  if (type !== "new") return false
  console.log(6)
  verifyObjIsMemberOf<{ point: NearestPoint, way: WayId, type: "new" }>({point, way, type})
  console.log(7)
  return true;
}
const isNewTappedLocation = (obj: object): obj is { newId: `new-${number}`, point: GeoJSON.Point, type: "new" } => {
  const type = "type" in obj && obj.type
  if (type !== "new") return false;
  const newId = "newId" in obj && obj.newId
  if (typeof newId !== "string") return false
  const prefix = newId.substring(0, 4)
  const suffix = newId.substring(4)
  const suffixNum = +suffix
  if (prefix !== "new-") return false
  if (suffixNum.toString() !== suffix) return false
  const point = "point" in obj && !!obj.point && isPoint(obj.point) && obj.point
  if (!point) return false
  verifyObjIsMemberOf<{ newId: `new-${number}`, point: GeoJSON.Point, type: "new" }>({
    newId: `new-${suffixNum}`, point, type
  })
  return true;
}
const isINode = (obj: object): obj is OsmApiJSON.INode => {
  const type = "type" in obj && obj.type
  if (type !== "node") return false
  const uid = "uid" in obj && obj.uid
  if (typeof uid !== "number") return false
  const user = "user" in obj && obj.user
  if (typeof user !== "string") return false
  const changeset = "changeset" in obj && obj.changeset
  if (typeof changeset !== "number") return false
  const version = "version" in obj && obj.version
  if (typeof version !== "number") return false
  const id = "id" in obj && obj.id
  if (typeof id !== "number") return false
  const lat = "lat" in obj && obj.lat
  if (typeof lat !== "number") return false
  const lon = "lon" in obj && obj.lon
  if (typeof lon !== "number") return false
  const timestamp = "timestamp" in obj && obj.timestamp
  if (typeof timestamp !== "string") return false
  const tags = "tags" in obj && obj.tags
  const c: OsmApiJSON.INode = {
    type, id, lat, lon, timestamp, version, changeset, user, uid,
  }

  if (tags) {
    if (isStringRecord(tags)) c.tags = tags; else return false
  }

  return true
}
const isTargetNode = (obj: object): obj is TargetNode => {
  const type = "type" in obj && obj.type
  if (type !== "Feature") return false;

  const geometry = "geometry" in obj && !!obj.geometry && isPoint(obj.geometry) && obj.geometry
  if (!geometry) return false

  const properties = "properties" in obj && !!obj.properties && isINode(obj.properties) && obj.properties
  if (!properties) return false
  const isWays = (obj: object): obj is { ways: string[] } => {
    if (!("ways" in properties)) return false
    if (!(properties.ways instanceof Array)) return false
    return !properties.ways.some(a => typeof a !== "string")
  }
  if (!isWays(properties)) return false

  verifyObjIsMemberOf<TargetNode>({type, properties, geometry})
  return true;
}

const verifyAsStopSign = (change: unknown): State['modes']['addStopSign']['change'] | undefined => {
  const fail = (msg: string) => { throw msg }
  try {
    if (!change || typeof change !== 'object') return undefined
    const type = "type" in change && change.type === "add stop sign" ? "add stop sign" as const : fail("type was wrong")
    const direction = "direction" in change ? (change.direction
    === undefined
    || change.direction
    === "forward"
    || change.direction
    === "backward" ? change.direction : fail("direction was wrong")) : undefined
    const selectedWays = "selectedWays"
    in change
    && change.selectedWays
    instanceof Array
    && !change.selectedWays.some(s => (typeof s !== "string")) ? change.selectedWays : fail("selected ways was wrong")
    const tappedLocation = "tappedLocation" in change && (change.tappedLocation
        === null
        || typeof change.tappedLocation
        === "object") ? (change.tappedLocation === null || isNewTappedLocation(change.tappedLocation) || isTargetNode(
        change.tappedLocation) ? change.tappedLocation : fail("tapped loc 2")) : fail("tapped location was wrong")
    const highwayLocation = "highwayLocation" in change && (change.highwayLocation
        === null
        || typeof change.highwayLocation
        === "object") ? (change.highwayLocation
    === null
    || isNewHighwayLocation(change.highwayLocation)
    || isTargetNode(change.highwayLocation)
        ? change.highwayLocation
        : fail(`highway loc 2  ${JSON.stringify(change.highwayLocation)}`)) : fail("highway location was wrong")

    return {type, tappedLocation, highwayLocation, direction, selectedWays}
    /* ref {
             type: "add stop sign"
             tappedLocation: { newId: `new-${number}`, point: GeoJSON.Point, type: "new" } | TargetNode | null
             highwayLocation: { way: WayId, point: GeoJSON.Point } | TargetNode | null
             direction: "forward" | "backward" | undefined
             selectedWays: WayId[]
          }*/
  } catch (e) {
    console.log("could not verify as stop sign", e)
    return undefined
  }
}


const roadStrokesLayerStyle = (wayIds: string[] | null): MapLibreGL.LineLayerStyle => ({
  lineColor: wayIds ? ["case", ["in", ["id"], ["literal", wayIds]], "purple", "red"] : "red",
  lineOpacity: ["case", ["in", ["geometry-type"], ["literal", "LineString"]], 1, 0]
})

const roadcasingsLayerStyle = (wayIds: string[] | null): MapLibreGL.FillLayerStyle => ({
  fillColor: wayIds ? ["case", ["in", ["id"], ["literal", wayIds]], "purple", "red"] : "red",
  fillOpacity: ["case", ["in", ["geometry-type"], ["literal", "Polygon"]], 0.98, 0]
})

const pointsOnWayNearClickLayerStyle = (nodeIds: string[]): MapLibreGL.CircleLayerStyle => ({
  circleColor: ["case", ["in", ["id"], ["literal", nodeIds]], "blue", "gray"],
  circleOpacity: 1,
  circleStrokeWidth: 2,
  circleStrokeColor: "white",
  circleRadius: 5,
  circlePitchAlignment: "map"
})

const circleLayerStyle = (input: number | undefined): MapLibreGL.CircleLayerStyle => ({
  circleColor: input ? ["case", ["==", ["id"], input.toString()], "yellow", "purple"] : "green",
  circleOpacity: 0.84,
  circleStrokeWidth: 2,
  circleStrokeColor: "white",
  circleRadius: 5,
  circlePitchAlignment: "map"
})


const styles = StyleSheet.create({
  fab1: {
    position: 'absolute', margin: 16, left: 0, bottom: 48
  }, fab: {
    position: 'absolute', margin: 16, right: 0, bottom: 48
  }, page: {
    flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5FCFF',
  }, map: {
    flex: 1, alignSelf: 'stretch',
  },
});

type Mode = keyof State['modes']
const ismode = (mode: string): mode is Mode => mode in initialState.modes

type State = {
  initialSetup: boolean,
  neededForLoading: number | undefined,
  mode: Mode
  modes: {
    browse: object
    addStopSign: {
      changeId: number | undefined
      change: StopSignChange
    }
  }
  zoom: number
  centreCoordinates: GeoJSON.Position | undefined,
  visibleBounds: { minlat: number, minlon: number, maxlat: number, maxlon: number } | undefined
  sameRoads: PartialRecord<WayId, WayId[]>
  intersections_i: PartialRecord<WayId, IntersectingWayInfo>
  queries: {
    queryNodes: QueryState<unknown, GeoJSON.FeatureCollection<GeoJSON.Point, OsmApiJSON.INode> | null>
    queryWays_: QueryState<unknown, {
      casings: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.LineString, OsmApiJSON.IWay> | null,
      centrelines: GeoJSON.FeatureCollection<GeoJSON.LineString, OsmApiJSON.IWay> | null
    }>
    interestingNodes: QueryState<unknown, InterestingNodes>
    osmCapabilities: QueryState<unknown, OsmApiJSON.IApiCapabilities>
    osmVersions: QueryState<unknown, OsmApiJSON.IInaRecord_api>
    unknownBounds: QueryState<unknown, { minlat: number, minlon: number, maxlat: number, maxlon: number } | null>
    sameRoads: QueryState<unknown, PartialRecord<WayId, WayId[]>>
    intersections_q: QueryState<unknown, PartialRecord<WayId, IntersectingWayInfo>>
    neededForLoading: QueryState<unknown, SavedChangeSet | null>
    saveNewUserDataChanges: MutationState<unknown, SavedChangeSet>
    saveUpdateUserDataChanges: MutationState<unknown, number>
  }
}

const initialState: State = {
  mode: 'browse', neededForLoading: undefined, initialSetup: true, modes: {
    browse: {}, addStopSign: {
      changeId: undefined, change: {
        type: "add stop sign", tappedLocation: null, highwayLocation: null, direction: undefined, selectedWays: [],
      }
    }
  }, visibleBounds: undefined, zoom: 14, centreCoordinates: undefined, sameRoads: {}, intersections_i: {}, queries: {
    neededForLoading: initialQueryState(),
    queryNodes: initialQueryState(),
    queryWays_: initialQueryState(),
    interestingNodes: initialQueryState(),
    unknownBounds: initialQueryState(),
    osmCapabilities: initialQueryState(),
    osmVersions: initialQueryState(),
    saveNewUserDataChanges: initialMutationState(),
    saveUpdateUserDataChanges: initialMutationState(),
    sameRoads: initialQueryState(),
    intersections_q: initialQueryState(),
  }
}

type SelectWay = { action: "select ways", ways: WayId[], select: "toggle", point: GeoJSON.Position }
type SetInitialSetup = { action: "post initial setup" }
type SetZoom = { action: "set zoom", zoom: number, centreCoordinates?: GeoJSON.Position }
type SetVisibleBounds = { action: "set visible bounds", visibleBounds: JsonBBox }
type SetQuery<Query extends keyof State['queries']> = {
  action: "set query", query: Query, queryState: State['queries'][Query]
}
type SetMode = { action: "set mode", mode: Mode }
type SelectInterestingPoint = { action: "select interesting point", point: TargetNode }
type ModalAction<M extends Mode> = { action: "modal", mode: M, modalAction: ActionInMode<M> }
type ActionInMode<M extends Mode> = M extends "browse" ? BrowseAction : M extends "addStopSign"
    ? AddStopSignAction
    : never
type BrowseAction = never
type AddStopSignAction = SelectInterestingPoint | SelectWay | ActionAddStopSign | ActionUpdateHighwayPoint
type ActionUpdateHighwayPoint = {
  action: "updated highway location", point: GeoJSON.Point
}
type ActionAddStopSign = { action: "add stop sign", tappedLocation: null } | {
  action: "add stop sign", tappedLocation: GeoJSON.Point, newId: `new-${number}`
}
type NeededForLoading = { action: "needed for loading", id: number }

type Action =
    ModalAction<"browse">
    | ModalAction<"addStopSign">
    | NeededForLoading
    | SetVisibleBounds
    | SetZoom
    | SetInitialSetup
    | SetMode
    | { action: "invalidate same roads" }
    | { action: "invalidate intersections" }
    | SetQuery<"unknownBounds">
    | SetQuery<"osmCapabilities">
    | SetQuery<"interestingNodes">
    | SetQuery<"queryNodes">
    | SetQuery<"queryWays_">
    | SetQuery<"osmVersions">
    | SetQuery<"sameRoads">
    | SetQuery<"intersections_q">
    | SetQuery<"saveNewUserDataChanges">
    | SetQuery<"saveUpdateUserDataChanges">
    | SetQuery<"neededForLoading">

const make_id = (() => {
  let id = 1
  return () => id++
})()


const mkNewHighwayNodeFromState = (
    wayId: WayId, state: State, relativePoint: GeoJSON.Position | GeoJSON.Point): NewPoint | undefined => {
  const wayGroup = state.modes.addStopSign.change.selectedWays.flatMap(w => state.sameRoads[w] || [])
  const waysCentrelines = state.queries.queryWays_.data?.centrelines?.features || []
  const wayCentrelines: Record<WayId, GeoJSON.Feature<GeoJSON.LineString, IWay>> = {}
  wayGroup.forEach(localWayId => {
    const way = waysCentrelines.find(w => w.id === localWayId)
    if (!way) return []
    wayCentrelines[localWayId] = way
  })
  return mkNewHighwayNode(wayId, wayCentrelines, relativePoint)
}

const reducer = (state: State, action: Action): State => {
  switch (action.action) {
    case "needed for loading": {
      return {...state, neededForLoading: action.id}
    }
    case "set mode": {
      switch (action.mode) {
        case "browse":
          return {...state, mode: action.mode, modes: initialState.modes}
        default:
          return {...state, mode: action.mode}
      }
    }
    case "modal": {
      switch (action.mode) {
        case "browse": {
          unusedButOkay(action.modalAction)
          return state
        }
        case "addStopSign": {
          const modalAction = action.modalAction
          switch (modalAction.action) {
            case "select interesting point": {
              if (modalAction.point.properties.ways.length
                  === 0
                  && modalAction.point.properties.tags?.highway
                  === undefined
                  && !state.modes.addStopSign.change.tappedLocation) {
                return {
                  ...state, modes: {
                    ...state.modes, addStopSign: {
                      ...state.modes.addStopSign, change: {
                        ...state.modes.addStopSign.change, tappedLocation: modalAction.point
                      }
                    }
                  }
                }
              } else if (modalAction.point.properties.ways.length === 1) {
                if (state.modes.addStopSign.change.highwayLocation
                    && state.modes.addStopSign.change.highwayLocation.type
                    === "Feature"
                    && state.modes.addStopSign.change.highwayLocation.id
                    === modalAction.point.id) {
                  return {
                    ...state, modes: {
                      ...state.modes, addStopSign: {
                        ...state.modes.addStopSign, change: {...state.modes.addStopSign.change, highwayLocation: null}
                      }
                    }
                  }
                } else {
                  return {
                    ...state, modes: {
                      ...state.modes, addStopSign: {
                        ...state.modes.addStopSign, change: {
                          ...state.modes.addStopSign.change,
                          highwayLocation: modalAction.point,
                          selectedWays: [...modalAction.point.properties.ways]
                        }
                      }
                    }
                  }
                }
              } else {
                return state
              }
            }
            case "select ways": {
              // change in the definition of the rule.
              // previously, we deselected the way if all of the ways were part of the selected set; otherwise
              // we selected the way.
              // now, we deselect the way if the way is selected and has a selected highway node; otherwise, we
              // select the way (in either case, we deselect any highway nodes that need deselection).
              // if, when we tap on a way - whether it is a selected but not deselectable way or an unselected
              // selectable way - we discover that there is no highway node, we create one at the tapped location.

              const way = modalAction.ways.length >= 1 && modalAction.ways[0]
              if (!way) return state

              const isAlreadySelected = state.modes.addStopSign.change.selectedWays.includes(way)
              const highwayNodeWays = state.modes.addStopSign.change.highwayLocation && ("way"
                  in state.modes.addStopSign.change.highwayLocation
                      ? [state.modes.addStopSign.change.highwayLocation.way]
                      : state.modes.addStopSign.change.highwayLocation.properties.ways)
              // note: i might want to just assume this is true, because it should be true and the data might not be
              // up-to-date const highwayNodeWaysSameRoadAsSelected = highwayNodeWays && highwayNodeWays.some(s =>
              // state.sameRoads[s]?.includes(way) || state.sameRoads[way]?.includes(s))

              if (isAlreadySelected && highwayNodeWays) {
                return {
                  ...state,
                  modes: {
                    ...state.modes,
                    addStopSign: {
                      ...state.modes.addStopSign,
                      change: {...state.modes.addStopSign.change, highwayLocation: null, selectedWays: []}
                    }
                  }
                }
              } else {
                const newHighwayNode = mkNewHighwayNodeFromState(way, state, modalAction.point)
                console.log("new higway node", newHighwayNode)
                return {
                  ...state,
                  modes: {
                    ...state.modes,
                    addStopSign: {
                      ...state.modes.addStopSign,
                      change: {
                        ...state.modes.addStopSign.change,
                        highwayLocation: newHighwayNode || null,
                        selectedWays: [way]
                      }
                    }
                  }
                }
              }
            }
            case "add stop sign": {
              return {
                ...state, modes: {
                  ...state.modes, addStopSign: {
                    ...state.modes.addStopSign, change: {
                      ...state.modes.addStopSign.change, tappedLocation: modalAction.tappedLocation ? {
                        type: "new", newId: modalAction.newId, point: modalAction.tappedLocation
                      } : null
                    }
                  }
                }
              }
            }
            case "updated highway location" : {
              const wayId = state.modes.addStopSign.change.selectedWays[0]
              const newHighwayNode = mkNewHighwayNodeFromState(wayId, state, modalAction.point)
              return (newHighwayNode === undefined) ? state : {
                ...state,
                modes: {
                  ...state.modes,
                  addStopSign: {
                    ...state.modes.addStopSign,
                    change: {
                      ...state.modes.addStopSign.change,
                      highwayLocation: newHighwayNode,
                      selectedWays: [newHighwayNode.way]
                    }
                  }
                }
              }
            }
            default: {
              unusedButOkay(modalAction)
              return state
            }
          }
        }
        default: {
          unusedButOkay(action)
          return state
        }
      }
    }
    case "invalidate same roads": {
      return {...state, sameRoads: {}}
    }
    case "invalidate intersections": {
      return {...state, intersections_i: {}}
    }
    case "post initial setup": {
      return state.initialSetup ? {...state, initialSetup: false} : state
    }
    case "set zoom": {
      console.log(action)
      return state.zoom === action.zoom ? state : {
        ...state, zoom: action.zoom, centreCoordinates: action.centreCoordinates
      }
    }
    case "set visible bounds": {
      if (!state.visibleBounds
          || state.visibleBounds.minlat
          !== action.visibleBounds.minlat
          || state.visibleBounds.minlon
          !== action.visibleBounds.minlon
          || state.visibleBounds.maxlat
          !== action.visibleBounds.maxlat
          || state.visibleBounds.maxlon
          !== action.visibleBounds.maxlon) {
        return {...state, visibleBounds: action.visibleBounds}
      } else {
        return state
      }
    }
    case "set query": {
      let updateState = {...state}
      if (action.queryState.status === "error") {
        console.log("error", action)
      }
      switch (action.query) {
        case "neededForLoading": {
          console.log("needed for loading?", action)
          if (action.queryState.status === "success") {
            const data = action.queryState.data
            console.log("needed for loading!", data)
            if (data) {
              const type1 = data.type as Mode
              switch (type1) {
                case "browse":
                  break;
                case "addStopSign": {
                  const id = typeof (data.id as unknown) === "number" && data.id
                  const state_extract = verifyAsStopSign(data.state_extract)
                  if (id && state_extract) {
                    updateState.modes.addStopSign.changeId = id
                    updateState.modes.addStopSign.change = state_extract
                    updateState.mode = "addStopSign"
                  } else {
                    console.log("we got some error", id, state_extract, data.state_extract)
                  }
                  break;
                }
              }
            }
            updateState.neededForLoading = undefined
          }
          break;
        }
        case "saveNewUserDataChanges": {
          const data = action.queryState.data
          if (action.queryState.status === "success" && data) {
            const type = data.type
            if (ismode(type)
                && "changeId"
                in updateState.modes[type]
                && updateState.modes[type].changeId
                === undefined) {
              updateState.modes[type].changeId = data.id
            }
          }
          break;
        }
        case "intersections_q":
        case "sameRoads": {
          // this works when I can use the generic to narrow things down, but not otherwise.
          // therefore, it's a closure.
          // it copies the data from the action into the state and deletes some of the older information
          // so that we don't hold onto too much.
          const query = action.query
          const process = <T extends 'sameRoads' | 'intersections_i'>(query: T) => {
            if (action.queryState.status === "success" && action.queryState.data) {
              const data = {...state[query], ...action.queryState.data}
              let unincluded = 0
              for (const key in data) {
                if (anyModeSelectsWay(state, key) || state.queries.queryWays_.data?.casings?.features.find(f => f.id
                    === key) || unincluded++ < 5) {
                } else {
                  delete data[key]
                }
              }
              updateState[query] = data
            }
          }
          process(query === 'intersections_q' ? 'intersections_i' : query)
          break;
        }
        case "queryWays_":
          if (state.zoom
              < 20
              && action.queryState.status
              === "success"
              && action.queryState.fetchStatus
              === "idle"
              && action.queryState.data?.casings?.features.length
              === MAX_FEATURES_QUERY) {
            console.log(
                "because max features",
                action.queryState.data?.casings.features.length,
                "zooming",
                state.zoom + 1
            )
            updateState = {...updateState, zoom: Math.floor(state.zoom) + 1}
          }
          break;
      }
      //remarkably, this can be done by copying but not by mutation.
      return {...updateState, queries: {...updateState.queries, [action.query]: action.queryState}}
    }
  }
}

function buildStatusString(
    debouncers: boolean[],
    queries: PartialRecord<string, MutationState<unknown, unknown> | QueryState<unknown, unknown>>
) {
  const buildStatusStr = (m: MutationState<unknown, unknown> | QueryState<unknown, unknown>): [string, string] => {
    if ("fetchStatus" in m) {
      switch (m.status) {
        case "success":
          switch (m.fetchStatus) {
            case "idle":
              return ["S", "black"]
            case "paused":
              return ["5", "black"]
            case "fetching":
              return ["s", "red"]
            default:
              return ["0", "black"]
          }
        case "error":
          switch (m.fetchStatus) {
            case "idle":
              return ["E", "orange"]
            case "paused":
              return ["3", "orange"]
            case "fetching":
              return ["e", "red"]
            default:
              return ["1", "orange"]
          }
        case "pending":
          switch (m.fetchStatus) {
            case "idle":
              return ["P", "navy"]
            case "paused":
              return ["B", "navy"]
            case "fetching":
              return ["p", "red"]
            default:
              return ["1", "black"]
          }
      }
    } else {
      switch (m.status) {
        case "idle":
          return ["_*", "black"]
        case "error":
          return ["e*", "orange"]
        case "pending":
          return ["p*", "red"]
        case "success" :
          return ["S*", "navy"]
      }
    }
  }

  return Object.entries(queries)
  .sort(([k1,], [k2,]) => k1.localeCompare(k2))
  .map(([k, m]) => {
    const [status, color] = buildStatusStr(m!)
    const identifier = k[0] + k.split('').filter(k => /[A-Z]/.test(k)).join('')
    return <Text key={k} style={{color}}>{identifier + status}</Text>
  })
  .concat(debouncers.map((d, i) => <Text key={"d" + i} style={{color: d ? "red" : "black"}}>{d ? "P" : "_"}</Text>))
}

function MapAddStopSign({state, setCommentary, highlightWays, setNotes, setChanges, setTappedLocation, dispatch}: {
  setTappedLocation: (a: GeoJSON.Point) => void,
  state: State,
  highlightWays: WayId[],
  dispatch: (a: Action) => void,
  setNotes: (notes: string[]) => void,
  setCommentary: (c: [string, string | undefined]) => void,
  setChanges: (changes: Change[]) => void
}) {
  const refTappedLoc = useRef<MapLibreGL.PointAnnotationRef>(null)
  const refNearestPointAnnoPoint = useRef<MapLibreGL.PointAnnotationRef>(null)
  const refNearestPointShape = useRef<MapLibreGL.ShapeSourceRef>(null)

  const editableSign = state.modes.addStopSign.change.tappedLocation?.type === "Feature"
      ? state.modes.addStopSign.change.tappedLocation.geometry
      : state.modes.addStopSign.change.tappedLocation?.point
  const constructedSign = useMemo(() => {
        const activeWays = state.queries.queryWays_.data?.centrelines?.features
        .filter(f => f.id && highlightWays.includes(f.id.toString())) || []
        return modalNotes(state.intersections_i, state.modes.addStopSign.change, activeWays)
      },
      [
        state.intersections_i,
        state.modes.addStopSign.change,
        state.queries.queryWays_.data?.centrelines?.features,
        highlightWays])
  useEffect(() => {
    const notes = [...constructedSign.notes, "hu", JSON.stringify(constructedSign.osmChange)]
    setNotes(notes)
    setChanges(constructedSign.changesOld)
    setCommentary([
      `hke${constructedSign.commentary[0]}\n${JSON.stringify(constructedSign.osmChange)}`,
      `hka${constructedSign.commentary[1]}\n${JSON.stringify(constructedSign.osmChange)}`])
  }, [constructedSign, setNotes, setChanges, setCommentary])
  const signFaceAngle = constructedSign.signFaceAngle
  const radians = signFaceAngle === undefined ? undefined : signFaceAngle * Math.PI / 180
  const setNearestPointLocation = (event: FeaturePayload) => dispatch({
    action: "modal", mode: "addStopSign", modalAction: {
      action: "updated highway location", point: event.geometry
    }
  })
  const nearestPoint = state.modes.addStopSign.change.highwayLocation?.type === "new"
      ? state.modes.addStopSign.change.highwayLocation
      : undefined

  const nearestPointShape: GeoJSON.Feature<GeoJSON.Point, object> | undefined = nearestPoint
      ? nearestPoint.point
      : undefined
  const nearestPointId = nearestPointShape?.id ? [nearestPointShape.id.toString()] : []

  const dragEndSignLocation = useCallback((e: FeaturePayload) => setTappedLocation(e.geometry), [setTappedLocation])

  return <>
    {nearestPoint && <>
        <MapLibreGL.PointAnnotation style={{zIndex: 3, elevation: 3}}
                                    key={nearestPoint.way}
                                    ref={refNearestPointAnnoPoint}
                                    onSelected={e => console.log("selected", e)}
                                    onDragEnd={setNearestPointLocation}
                                    id={`nearestpoint-${nearestPoint.way}`}
                                    coordinate={nearestPoint.point.geometry.coordinates}
                                    draggable={true}>
            <View style={{zIndex: 3, elevation: 3}}>
                <Svg.Svg height="10" width="10" viewBox="0 0 100 100">
                    <Svg.Circle cx="50" cy="50" r="43" stroke="orange" strokeWidth="14" fill="yellow"/>
                </Svg.Svg>
            </View>
        </MapLibreGL.PointAnnotation>
        <MapLibreGL.ShapeSource
            id="nearestPointShape"
            shape={nearestPointShape}
            ref={refNearestPointShape}
        >
            <CircleLayer
                layerIndex={LayerIndexLookup['nearestPointLayer']}
                id="nearestPointLayer"
                style={pointsOnWayNearClickLayerStyle(nearestPointId)}
            />

        </MapLibreGL.ShapeSource>
    </>}
    {editableSign && <MapLibreGL.PointAnnotation key={radians} ref={refTappedLoc}
                                                 onDragEnd={dragEndSignLocation} id="centrepoint"
                                                 coordinate={editableSign.coordinates} draggable={true}>
        <View>
            <Svg.Svg height="25" width="25" viewBox="0 0 100 100">
                <Svg.Defs>
                    <Svg.Marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6"
                                markerHeight="6" orient="auto">
                        <Svg.Path stroke="orange" d="M 0 0 L 10 5 L 0 10 z"/>
                    </Svg.Marker>
                </Svg.Defs>
                <Svg.Circle cx="50" cy="50" r="43" stroke="blue" strokeWidth="7" fill="none"/>
              {radians !== undefined ? <>
                <Svg.Line
                    stroke={radians !== 0 ? "red" : "black"} strokeWidth="10"
                    x1={50 + (43) * Math.cos(radians + Math.PI)}
                    y1={50 + (43) * Math.sin(radians + Math.PI)}
                    x2={50 + (43) * Math.cos(radians)} y2={50 + (43) * Math.sin(radians)}></Svg.Line>
                <Svg.Line
                    markerEnd='url(#arrow)'
                    stroke={radians !== 0 ? "orange" : "black"} strokeWidth="10"
                    x1={50} y1={50}
                    x2={50 + (43) * Math.cos(radians - Math.PI / 2)}
                    y2={50 + (43) * Math.sin(radians - Math.PI / 2)}></Svg.Line>
              </> : false}
            </Svg.Svg>
        </View>
    </MapLibreGL.PointAnnotation>}
  </>
}

// noinspection JSUnusedGlobalSymbols default export is automatically included by expo-router
export default function MainPage() {
  /* standard/project effects */
  const params = useLocalSearchParams<{ id?: string }>()
  useAndroidLocationPermission(undefined)
  const queryClient = useQueryClient()
  const queries = useMainPageQueries()
  const [state, xdispatch] = useReducer(reducer, initialState)
  const dispatch = useCallback((a: Action) => {
    console.log("action", a.action, "query" in a && a.query, "modalAction" in a && a.modalAction);
    return xdispatch(a)
  }, [xdispatch])
  const refCamera = useRef<MapLibreGL.CameraRef>(null)
  const refHighwaystopSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const refPointsOnWayNearClickSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const refRoadcasingsSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const refMapView = useRef<MapLibreGL.MapViewRef | null>(null)


  console.log(
      "params",
      params,
      state.neededForLoading,
      state.queries.neededForLoading,
      state.modes.addStopSign,
      state.mode
  )

  useEffect(() => {
    const idstr = params.id as unknown
    if (!idstr || typeof idstr !== "string") return
    try {
      const id = JSON.parse(idstr) as unknown
      console.log("going to run with id", id)
      if (typeof id !== "number") return
      dispatch({action: "needed for loading", id})
    } catch (e) {
      unusedKnownType(e)
      return
    }

  }, [params.id, dispatch])

  /* simple synonoms */
  const visibleBounds = state.visibleBounds;
  const doublePaddedBounds = visibleBounds && doublePad(visibleBounds)

  const interestingPoints = state.queries.interestingNodes.data

  const mapArea = visibleBounds ? (visibleBounds.maxlon - visibleBounds.minlon) * (visibleBounds.maxlat
      - visibleBounds.minlat) : undefined
  const capability = state.queries.osmCapabilities.data?.api.area.maximum
  const osmMapArgs: JsonBBox | undefined = state.queries.unknownBounds.data || visibleBounds
  const invalidateSameRoads = useCallback(() => dispatch({action: "invalidate same roads"}), [dispatch])
  const {queryWays} = useOsmPopulator(
      visibleBounds,
      osmMapArgs,
      state.queries.unknownBounds.status === 'success' && !!state.queries.unknownBounds.data,
      invalidateSameRoads,
      InteractionManager.runAfterInteractions
  )
  useEffect(() => {
    dispatch({action: "set query", query: "queryWays_", queryState: queryWays})
  }, [dispatch, queryWays])
  const symbols = state.queries.queryNodes.data || null
  const roadcasings = state.queries.queryWays_.data?.casings || null

  const fab = true
  const [subFab, setSubFab] = useState(false)

  const modalSelectedWays = currentModesSelectedWays(state)
  const highlightWays = useMemo(() => nub(modalSelectedWays.concat(modalSelectedWays.flatMap(f => state.sameRoads[f]
      || []))), [modalSelectedWays, state.sameRoads])

  const interestingNodesParams = doublePaddedBounds && (() => {
    const params = interestingNodesParamsFromMode(state)
    return params && {...params, ...doublePaddedBounds}
  })()
  const hasInterestingNodes = !!interestingNodesParams
  const allModeSelectedWays = allModesSelectedWays(state)

  /* queries */
  {
    const neededIntersections = modalSelectedWays.filter(f => !(f in state.intersections_i)
        || !state.intersections_i[f])
    useDispatchingQuery(useCallback((queryState: QueryState<unknown, PartialRecord<WayId, IntersectingWayInfo>>) => dispatch(
        {
          action: "set query", query: "intersections_q", queryState
        }), [dispatch]), {
      queryKey: ["spatialite", "ways", "intersections", neededIntersections],
      enabled: neededIntersections.length > 0,
      queryFn: () => queries.current.doFindIntersections(neededIntersections),
    })
  }
  {
    const relatedWays = Object.values(state.sameRoads).flatMap(f => f || [])
    const neededRoads = nub(relatedWays.concat(allModeSelectedWays.filter(f => !(f in state.sameRoads)
        || !state.sameRoads[f])))
    useDispatchingQuery(useCallback((queryState: QueryState<unknown, PartialRecord<WayId, WayId[]>>) => dispatch({
      action: "set query",
      query: "sameRoads",
      queryState: queryState.data ? debug("this is a same roads query state", queryState) : queryState
    }), [dispatch]), {
      queryKey: ["spatialite", "ways", "road ways", neededRoads],
      enabled: neededRoads.length > 0,
      queryFn: () => queries.current.doFindSameRoads(neededRoads),
    })
  }
  useDispatchingQuery(useCallback((queryState: QueryState<unknown, InterestingNodes>) => dispatch({
    action: "set query", query: "interestingNodes", queryState
  }), [dispatch]), {
    queryKey: ["spatialite", "nearby ways", interestingNodesParams],
    enabled: hasInterestingNodes,
    placeholderData: (data) => data,
    queryFn: interestingNodesParams
        ? (() => queries.current.doFindTargetNodes(interestingNodesParams))
        : () => new Promise(() => {})
  })

  useDispatchingQuery(useCallback((queryState: QueryState<unknown, JsonBBox | null>) => dispatch({
    action: "set query", query: "unknownBounds", queryState
  }), [dispatch]), {
    queryKey: ["spatialite known bounds", visibleBounds],
    enabled: !!mapArea && !!capability && !!visibleBounds && (mapArea * 10 <= capability),
    queryFn: visibleBounds ? async () => {
      console.log("mew, mew")
      const result = (await queries.current.doKnownBounds(visibleBounds))
      if (result && result.bbox) {
        const [minlon, minlat, maxlon, maxlat] = result.bbox
        return {minlon, minlat, maxlon, maxlat}
      } else {
        return null
      }
    } : skipToken
  })


  useDispatchingQuery(useCallback((queryState: QueryState<unknown, GeoJSON.FeatureCollection<GeoJSON.Point, OsmApiJSON.INode> | null>) => dispatch(
      {
        action: "set query", query: "queryNodes", queryState
      }), [dispatch]), {
    queryKey: ["spatialite query nodes", (doublePaddedBounds || {})],
    enabled: !!doublePaddedBounds,
    queryFn: doublePaddedBounds
        ? (async (): Promise<GeoJSON.FeatureCollection<GeoJSON.Point, OsmApiJSON.INode> | null> => {
          const nodes = await fromAsync(queries.current.doQueryNodes(doublePaddedBounds))
          return nodes.length ? {type: "FeatureCollection", features: nodes} : null
        })
        : undefined
  })


  useDispatchingQuery(useCallback((queryState: QueryState<unknown, OsmApiJSON.IInaRecord_api>) => dispatch({
    action: "set query", query: "osmVersions", queryState
  }), [dispatch]), {
    queryKey: ['osm query version'],
    queryFn: OsmApiJSON.getApiVersions,
    staleTime: 7 * 24 * 60 * 60 * 1000,
    placeholderData: (prev) => (prev || {api: {versions: ["0.6" as const]}})
  })

  const neededForLoading = state.neededForLoading;
  useDispatchingQuery(useCallback((queryState: QueryState<unknown, SavedChangeSet | null>) => dispatch({
    action: "set query", query: "neededForLoading", queryState
  }), [dispatch]), {
    queryKey: ['spatialite', 'needed for loading', neededForLoading],
    enabled: !!neededForLoading,
    queryFn: neededForLoading ? (() => queries.current.doselectUserChange(neededForLoading)) : skipToken
  })

  useDispatchingQuery(useCallback((queryState: QueryState<unknown, OsmApiJSON.IApiCapabilities>) => dispatch({
    action: "set query", query: "osmCapabilities", queryState
  }), [dispatch]), {
    queryKey: ['osm query capabilities', state.queries.osmVersions.data],
    enabled: state.queries.osmVersions.status === 'success' && state.queries.osmVersions.data.api.versions.includes(
        "0.6"),
    queryFn: OsmApiJSON.getApi06Capabilities,
    staleTime: 7 * 24 * 60 * 60 * 1000,
    placeholderData: (prev) => (prev || {
      api: {
        version: {minimum: "0.6" as const, maximum: "0.6" as const},
        area: {maximum: 0.125},
        note_area: {maximum: 1},
        tracepoints: {per_page: 0},
        waynodes: {maximum: 100},
        relationmembers: {maximum: 100},
        changesets: {maximum_elements: 8, default_query_limit: 10, maximum_query_limit: 10},
        notes: {default_query_limit: 10, maximum_query_limit: 10},
        timeout: {seconds: 100},
        status: {
          database: "offline" as const, api: "offline" as const, gpx: "offline" as const,
        }
      }, policy: {imagery: {blacklist: []}},
    })
  })
  const [changes, setChanges] = useState<Change[]>([])
  const [commentary, setCommentary] = useState<[string, string | undefined]>(["Browse", undefined])

  /* mutations */
  const qSaveUpdateUserChanges = useDispatchingMutation(useCallback((queryState: MutationState<unknown, number>) => dispatch(
      {
        action: "set query", query: "saveUpdateUserDataChanges", queryState
      }), [dispatch]), {
    mutationFn: ({id, args, commentary}: {
      id: number,
      args: MyChangeSet,
      commentary: [string, string | undefined]
    }) => queries.current.doSaveUpdateChange(id, args, commentary), onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['spatialite', 'needed for loading']})
    }
  })
  const debSaveUpdateUserChanges = useDebouncedCallback((args: {
    id: number,
    args: MyChangeSet,
    commentary: [string, string | undefined]
  }) => {
    console.log("the debouncee has been triggered", args)
    qSaveUpdateUserChanges.mutate(args)
  }, 250, {maxWait: 10_000})


  const modeSettings = state.modes[state.mode]
  useEffect(() => {
        if ("changeId" in modeSettings && typeof modeSettings.changeId === "number" && state.mode !== 'browse') {
          console.log("we have further got enough data to save", modeSettings.changeId)
          debSaveUpdateUserChanges({
            commentary, id: modeSettings.changeId, args: {
              type: state.mode, change: changes, state_extract: modeSettings.change
            }
          })
        }
      }

      , [state.mode, modeSettings, changes, debSaveUpdateUserChanges, commentary])

  const qSaveNewUserChanges = useDispatchingMutation(useCallback((queryState: MutationState<unknown, SavedChangeSet>) => dispatch(
      {
        action: "set query", query: "saveNewUserDataChanges", queryState
      }), [dispatch]), {
    mutationFn: (args: MyChangeSet) => queries.current.doSaveNewChange(args), onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ["spatialite", "needed for loading"]})
    }
  })

  const modeHasChanges = "changeId" in modeSettings ? modeSettings.changeId : null
  const qSaveNewUserChangesMutate = qSaveNewUserChanges.mutate
  useEffect(() => {
    if ("changeId" in modeSettings && modeSettings.changeId === undefined && state.mode !== 'browse') {
      qSaveNewUserChangesMutate({
        type: state.mode, change: changes, state_extract: modeSettings.change
      })
    }
  }, [state.mode, modeSettings, changes, modeHasChanges, qSaveNewUserChangesMutate])


  /* callbacks */
  const setTappedLocation = useCallback((tappedLocation: GeoJSON.Point | null, toggle = false) => {
    switch (state.mode) {
      case "addStopSign":
        const oldLoc = toggle && state.modes.addStopSign.change.tappedLocation
            ? null
            : state.modes.addStopSign.change.tappedLocation
        const loc = toggle && state.modes.addStopSign.change.tappedLocation ? null : tappedLocation
        return dispatch({
          action: "modal", mode: "addStopSign", modalAction: loc ? {
            action: "add stop sign",
            tappedLocation: loc,
            newId: oldLoc && oldLoc.type === "new" ? oldLoc.newId : `new-${make_id()}`
          } : {action: "add stop sign", tappedLocation: loc}
        })
      case "browse":
        return;
      default:
        unusedButOkay(state.mode)
        return;
    }
  }, [dispatch, state.mode, state.modes.addStopSign.change.tappedLocation])
  const onPressMap = (event: GeoJSON.Feature<GeoJSON.Point>) => {
    console.log("from map", event);
    setTappedLocation(event.geometry, true)
  }
  const onPressWay = (event: OnPressEvent) => {
    console.log("from way", event);
    switch (state.mode) {
      case "addStopSign":
        return dispatch({
          action: "modal",
          mode: "addStopSign",
          modalAction: {
            action: "select ways",
            ways: event.features.map(i => i.id!.toString()),
            select: "toggle",
            point: [event.coordinates.longitude, event.coordinates.latitude]
          }
        })
      case "browse":
        return
      default:
        unusedButOkay(state.mode)
        return;
    }
  }
  const statusString = buildStatusString([debSaveUpdateUserChanges.isPending()], state.queries)

  const onMapBoundChange = (feature: GeoJSON.Feature<GeoJSON.Point, MapLibreGL.RegionPayload>) => {
    console.log('+++++++++++++++observed map bounds change', feature)
    const [ne, sw] = feature.properties.visibleBounds
    const maxlon = ne[0]
    const maxlat = ne[1]
    const minlon = sw[0]
    const minlat = sw[1]
    dispatch({action: "set visible bounds", visibleBounds: {minlon, minlat, maxlon, maxlat}})
    if (feature.properties.isUserInteraction) // repeated setting of zoom level at initiation
    {
      console.log(
          "setting becaues ....",
          feature.properties.zoomLevel,
          feature.properties.isUserInteraction,
          state.initialSetup
      )
      dispatch({
        action: "set zoom", centreCoordinates: feature.geometry.coordinates, zoom: feature.properties.zoomLevel
      })
    } else {
      console.log(
          "not setting becaues ....",
          feature.properties.zoomLevel,
          feature.properties.isUserInteraction,
          state.initialSetup
      )
    }
  }

  useEffect(() => {
    setTimeout(() => dispatch({action: "post initial setup"}), 30_000)
  }, [dispatch])

  const [defaultOptionText, defaultOptionIcon, subfabs] = fabFromMode(state.mode)
  const fabButtonPress = () => {
    switch (state.mode) {
      case "browse":
        return setSubFab(!subFab)
      case "addStopSign":
        return console.log("need to support adding signs")
    }
  }
  const fabButtonLongPress = () => { setSubFab(true) }

  const onPressSelectInterestingPoint = (e: OnPressEvent) => {
    switch (state.mode) {
      case "addStopSign":
        const features: (GeoJSON.Feature<GeoJSON.Geometry, unknown>)[] = e.features
        console.log("an interesting point has been selected!", e)
        if (features.length === 1) {
          const feature = features[0]
          if (feature.geometry.type === "Point") {
            dispatch({
              action: "modal",
              mode: "addStopSign",
              modalAction: {action: "select interesting point", point: feature as TargetNode}
            })
          }
        } else if (features.length > 1) {
          dispatch({action: "set zoom", zoom: state.zoom + 2})
        }
        features.forEach(f => console.log("properties", f.properties))
        return
      case "browse":
        return
      default:
        unusedButOkay(state.mode)
        return
    }
  }

  const [notes, setNotes] = useState<string[]>([])

  const modalMap = state.mode === "addStopSign" ? <MapAddStopSign highlightWays={highlightWays} state={state}
                                                                  setNotes={setNotes} setCommentary={setCommentary}
                                                                  setChanges={setChanges} dispatch={dispatch}
                                                                  setTappedLocation={setTappedLocation}/> : (state.mode
      === "browse"
      || state.mode
      === 'testO') ? false : (unusedButOkay(state.mode), undefined)


  const selectedInterestingPoints = selectedInterestingPointsForMode(state)

  const locFab = state.mode === "addStopSign" && !state.modes.addStopSign.change.tappedLocation && (async () => {
    let {status} = await ExLoc.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.log('Permission to access location was denied');
      return;
    }

    let location = await ExLoc.getCurrentPositionAsync({});
    dispatch({
      action: "modal", mode: "addStopSign", modalAction: {
        action: "add stop sign", newId: `new-${7}` as const, tappedLocation: {
          type: "Point", coordinates: [location.coords.longitude, location.coords.latitude]
        }
      }

    })
  })

  return (<View
          style={styles.page}
      >
        <View style={{
          flexWrap: "wrap", alignContent: "center", flexDirection: "row", gap: 4, paddingLeft: 2, paddingRight: 2
        }}>{statusString}</View>
        <MapLibreGL.MapView
            onRegionDidChange={onMapBoundChange}
            ref={refMapView}
            style={styles.map}
            logoEnabled={false}
            styleURL="https://tiles.openfreemap.org/styles/liberty"
            onPress={onPressMap}
        >
          {modalMap}
          {interestingPoints && <MapLibreGL.ShapeSource
              id="interestingPoints"
              shape={interestingPoints}
              ref={refPointsOnWayNearClickSource}
              onPress={onPressSelectInterestingPoint}
          >
              <CircleLayer
                  layerIndex={LayerIndexLookup.pointsOnWayNearClicks}
                  id="pointsOnWayNearClicks"
                  style={pointsOnWayNearClickLayerStyle(selectedInterestingPoints)}
              />

          </MapLibreGL.ShapeSource>}
          {symbols && <MapLibreGL.ShapeSource
              id="highwaystop"
              shape={symbols}
              ref={refHighwaystopSource}
          >
              <CircleLayer
                  id="points"
                  layerIndex={LayerIndexLookup.points}
                  style={circleLayerStyle(undefined)}
              />

          </MapLibreGL.ShapeSource>}
          {roadcasings && <MapLibreGL.ShapeSource
              id="roadcasing"
              shape={roadcasings}
              ref={refRoadcasingsSource}
              onPress={onPressWay}
          >
              <MapLibreGL.FillLayer
                  id="roadcasingfill"
                  layerIndex={LayerIndexLookup.roadcasingfill}
                  style={roadcasingsLayerStyle(highlightWays)}
              />
              <MapLibreGL.LineLayer
                  id="roadstrokeslines"
                  layerIndex={LayerIndexLookup.roadcasinglines}
                  style={roadStrokesLayerStyle(highlightWays)}
              />

          </MapLibreGL.ShapeSource>}
          <MapLibreGL.Camera
              ref={refCamera}
              centerCoordinate={state.centreCoordinates}
              zoomLevel={state.zoom}
              followUserMode={MapLibreGL.UserTrackingMode.Follow}
              followUserLocation
          />

        </MapLibreGL.MapView>
        {(notes.length > 0 || changes.length > 0) && <View
            style={{left: 0, top: 0, margin: 16, padding: 16, backgroundColor: "#f0edeecc", position: "absolute"}}>
          {notes.map((note, i) => <Text key={i}>{note}</Text>)}
          {changes.map((note, i) => <Text style={{fontFamily: "monospace"}}
                                          key={i}>{JSON.stringify(note)}</Text>)}
        </View>}
        {locFab && <FAB
            style={{
              left: 0, alignItems: "flex-start", position: 'absolute', margin: 16, marginTop: 32, rowGap: 32, bottom: 0,
            }}
            visible={true}
            onPress={locFab}
            title={"+"}
            icon={undefined}
            color="green"
        />}
        <View
            style={{
              right: 0, alignItems: "flex-end", position: 'absolute', margin: 16, marginTop: 32, rowGap: 32, bottom: 0,
            }}
        >
          {subfabs.map(({icon, mode, text}) => <FAB
              key={mode}
              visible={subFab}
              onPress={() => {
                setSubFab(false);
                dispatch({action: "set mode", mode})
              }}
              title={text}
              icon={icon}
              color="orange"
          />)}
          <FAB
              visible={fab}
              onPress={fabButtonPress}
              onLongPress={fabButtonLongPress}
              title={defaultOptionText}
              icon={defaultOptionIcon}
              color="orange"
          /></View>
      </View>);
}

const fabFromMode = (mode: Mode): [
      string | undefined, IconNode, {
    icon: IconNode, text: string | undefined, mode: Mode
  }[]] => {
  switch (mode) {
    case "browse":
      return [
        undefined,
        {name: "menu", color: "white", type: "material-community"},
        [{icon: {name: "octagon", color: "red", type: "material-community"}, text: "Stop", mode: "addStopSign"}]]

    case "addStopSign":
      return [
        "Add Stop Sign",
        {name: "octagon", color: "white", type: "material-community"},
        [{icon: {name: "cancel", color: "white", type: "material"}, text: "Cancel", mode: "browse"}]]
  }
}

const sha256: ((ascii: string) => string | undefined) = function sha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  let mathPow = Math.pow;
  let maxWord = mathPow(2, 32);
  const lengthProperty = 'length'
  let i, j; // Used as a counter across the whole file
  let result = ''

  let words: number[] = [];
  let asciiBitLength = ascii[lengthProperty] * 8;

  /* caching results is optional - remove/add slash from front of this line to toggle
  // Initial hash value: first 32 bits of the fractional parts of the square roots of the first 8 primes
  // (we actually calculate the first 64, but extra values are just ignored)
  var hash: number[] = sha256h.h = sha256h.h || [];
  // Round constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes
  var k: number[] = sha256h.k = sha256h.k || [];
  var primeCounter = k[lengthProperty];
  /*/
  let hash: number[] = [], k: number[] = [];
  let primeCounter = 0;
  //*/

  let isComposite: PartialRecord<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80' // Append Ƈ' bit (plus zero padding)
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00' // More zero padding
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) throw ["character out of range", i, j]; // ASCII check: only accept characters in range 0-255
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
  words[words[lengthProperty]] = (asciiBitLength)

  // process each chunk
  for (j = 0; j < words[lengthProperty];) {
    let w = words.slice(j, j += 16); // The message is expanded into 64 words as part of the iteration
    let oldHash = hash;
    // This is now the undefinedworking hash", often labelled as variables a...g
    // (we have to truncate as well, otherwise extra entries at the end accumulate
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      // Expand the message into 64 words
      // Used below if
      let w15 = w[i - 15], w2 = w[i - 2];

      // Iterate
      let a = hash[0], e = hash[4];
      let temp1 = hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) // S1
          + ((e & hash[5]) ^ ((~e) & hash[6])) // ch
          + k[i]
          // Expand the message schedule if needed
          + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) // s0
                  + w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10)) // s1
              ) | 0);
      // This is only used once, so *could* be moved below, but it only saves 4 bytes and makes things unreadble
      let temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) // S0
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2])); // maj

      hash = [(temp1 + temp2) | 0].concat(hash); // We don't bother trimming off the extra ones, they're harmless as
                                                 // long as we're truncating when we do the slice()
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      let b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
  }
  console.log("hash result")
  return result;
};

function bytesToBase64(str: string) {
  const bytes = new TextEncoder().encode(str)
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte),).join("");
  return btoa(binString);
}

const selectedInterestingPointsForMode = (state: State): string[] => {
  switch (state.mode) {
    case "browse":
      return []
    case "addStopSign":
      return [
        state.modes.addStopSign.change.tappedLocation?.type
        === "Feature"
        && state.modes.addStopSign.change.tappedLocation.id?.toString(),
        state.modes.addStopSign.change.highwayLocation
        && state.modes.addStopSign.change.highwayLocation.type
        === "Feature"
        && state.modes.addStopSign.change.highwayLocation.id?.toString()].flatMap(m => m ? [m] : [])
  }
}

const interestingNodesParamsFromMode = (state: State): undefined | Omit<InterestingNodesParams, 'minlon' | 'minlat' | 'maxlon' | 'maxlat'> => {
  switch (state.mode) {
    case "browse":
      return undefined
    case "addStopSign":
      return {
        $needles: [
          {"highway": "stop"}, {"traffic_sign": "stop"}, {"highway": "give_way"}, {"highway": "giveway"}]
      }
  }
}


const currentModesSelectedWays = (state: State): WayId[] => {
  switch (state.mode) {
    case "browse":
      return []
    case "addStopSign":
      return state.modes.addStopSign.change.selectedWays
    default:
      unusedButOkay(state.mode)
      return []
  }
}
const allModesSelectedWays = (state: State): WayId[] => {
  //weird logic to help typescript help me
  //note that this doesn't check the current mode - it only looks at the stored state
  return (Object.keys(state.modes).flatMap(k => {
    const t: keyof State['modes'] = k as keyof State['modes'] //this happens to be safe due to the logic of the
                                                              // switch - the default returns false
    switch (t) {
      case "addStopSign": {
        return state.modes.addStopSign.change.selectedWays
      }
      case "browse":
        return []
      default:
        unusedButOkay(t)
        return []
    }
  }))
}
const anyModeSelectsWay = (state: State, wayId: WayId) => {
  //weird logic to help typescript help me
  //note that this doesn't check the current mode - it only looks at the stored state
  return Object.keys(state.modes).some(k => {
    const t: keyof State['modes'] = k as keyof State['modes'] //this happens to be safe due to the logic of the
                                                              // switch - the default returns false
    switch (t) {
      case "addStopSign": {
        return state.modes.addStopSign.change.selectedWays.includes(wayId)
      }
      case "browse": {
        return false
      }
      default:
        unusedButOkay(t)
        return false
    }
  })
}


type MyChangeSet_<M extends Mode, Y, X extends State['modes'][M] & { change: Y }> = {
  type: M, change: Change[], state_extract: X['change']
}
type MyChangeSet = MyChangeSet_<"addStopSign", State['modes']["addStopSign"]["change"], State['modes']["addStopSign"]>

// noinspection JSUnusedLocalSymbols
const unusedKnownType = function (something: unknown): void {}
const unusedButOkay = (never: never): undefined => undefined
const verifyObjIsMemberOf = function <T = never>(val: T) { return val }

type FeaturePayload = GeoJSON.Feature<GeoJSON.Point, {
  screenPointX: number; screenPointY: number;
}>
