import type GeoJSON from "geojson";
import {bound, IntersectingWayInfo, lazy, PartialRecord, TargetNode, WayId} from "@/components/types";
import * as OsmApiJSON from "@/scripts/clients";
import {OsmObject, Change} from "@/components/diff-info/shared";
import * as turf from "@turf/turf";
import {OsmChange, OsmChangeElement} from "@/scripts/ts-xml-object-parser/osm-diff";


export const user_agent = 'cosm/2025.11.30 (android)'

export type NearestPoint = GeoJSON.Feature<GeoJSON.Point, {
  dist: number; index: number; location: number; triggeringWayId: WayId; segmentWayId: WayId;
}>

type TurfNearestPoint = GeoJSON.Feature<GeoJSON.Point, {
  dist: number; index: number; location: number;
}>

export type StopSignChange = {
  type: "add stop sign"
  tappedLocation: { newId: `new-${number}`, point: GeoJSON.Point, type: "new" } | TargetNode | null
  highwayLocation: { way: WayId, point: NearestPoint, type: "new" } | TargetNode | null
  direction: "forward" | "backward" | undefined
  selectedWays: WayId[]
}

export const modalNotes = (
    intersections: PartialRecord<WayId, IntersectingWayInfo>, addStopSign: StopSignChange,
    selectedWays: GeoJSON.Feature<GeoJSON.LineString, OsmApiJSON.IWay>[]
): {
  signFaceAngle: number | undefined,
  changesOld: Change[],
  osmChange: OsmChange,
  notes: string[],
  commentary: [string, string | undefined]
} => {
  const usedIxes: Record<`new-${number}`, number> = {}
  const versionIdNumber = (val: `new-${number}`): number => {
    if (val in usedIxes) {
      return usedIxes[val]
    } else {
      usedIxes[val] = -1 - Object.keys(usedIxes).length
      return usedIxes[val]
    }
  }

  let sign: 'new' | 'edit' | 'none' | undefined = undefined
  let line: 'new' | 'edit' | 'none' | undefined = undefined
  let on: string | undefined = selectedWays.map(w => w.properties.tags?.name).filter(f => !!f)[0]
  const signTypeAngle = 180
  let signFaceAngle: number | undefined = undefined
  const notes = []
  const changesOld: { object: OsmObject, set_tags: PartialRecord<string, string> }[] = []
  const osmCreate: OsmChangeElement[] = []
  const osmDelete: OsmChangeElement[] = []
  const osmModify: OsmChangeElement[] = []

  const tappedLocation = addStopSign.tappedLocation;
  const tappedLocationPoint = tappedLocation ? (tappedLocation.type === "new"
      ? tappedLocation.point
      : tappedLocation.geometry) : undefined
  const highwayLocation = addStopSign.highwayLocation;
  const highwayLocationPoint = highwayLocation ? (highwayLocation.type === "Feature"
      ? highwayLocation.geometry
      : highwayLocation.point) : undefined

  const inferredSignDirectionAndAngle = tappedLocationPoint ? lazy(() => inferDirectionAndAngle(
      tappedLocationPoint,
      selectedWays,
      intersections
  )) : () => ({
    angle: undefined,
    direction: undefined,
    wayId: undefined
  })
  const inferredHighwayDirectionAndAngle = highwayLocationPoint
      ? lazy(() => inferDirectionAndAngle(highwayLocationPoint, selectedWays, intersections))
      : () => ({angle: undefined, direction: undefined, wayId: undefined})
  const highwayDirection = addStopSign.direction || directionFromString(highwayLocation?.type
      === "Feature"
      && highwayLocation.properties.tags?.direction) || inferredHighwayDirectionAndAngle().direction

  if (tappedLocation
      && highwayLocation
      && inferredSignDirectionAndAngle().wayId
      !== inferredHighwayDirectionAndAngle().wayId) {
    notes.push("Note: something might be off because the inferred ways are different")
  }

  if (inferredHighwayDirectionAndAngle().direction !== highwayDirection) {
    notes.push(
        "Note: something might be off because a different direction has been inferred than the configured direction")
  }

  if (tappedLocation
      && highwayLocation
      && inferredSignDirectionAndAngle().direction
      !== inferredHighwayDirectionAndAngle().direction) {
    notes.push("Note: the road and sign have different inferred directions. The sign follows the road.")
  }

  if (!tappedLocation) {
    sign = 'none'
    notes.push("Add a stop sign in its physical location by tapping the map where the sign is.",)
  } else {
    const inferredAngle = inferredSignDirectionAndAngle().angle
    const apparentDirection = inferredHighwayDirectionAndAngle().direction || inferredSignDirectionAndAngle().direction
    signFaceAngle = inferredAngle === undefined ? undefined : Math.round(bound(inferredAngle
        + signTypeAngle
        + (apparentDirection === "backward" ? 180 : 0), 0, 360))
    const signTags: Record<string, string> = rmUndef({
      direction: signFaceAngle?.toString(), "traffic_sign": "stop"
    })
    if (tappedLocation.type === "new") {
      sign = 'new'
      notes.push("Adding a new stop sign")
      osmCreate.push({
        tag: 'node',
        version: 0,
        id: versionIdNumber(tappedLocation.newId),
        lon: tappedLocation.point.coordinates[0],
        lat: tappedLocation.point.coordinates[1],
        tags: signTags
      })
      changesOld.push({
        object: {
          type: "node", position: tappedLocation.point.coordinates, node_id: tappedLocation.newId
        }, set_tags: signTags
      })
    } else if (tappedLocation.type === "Feature") {
      sign = 'edit'
      if (tappedLocation.properties.tags && a_includes_b(tappedLocation.properties.tags, signTags)) {
        notes.push("A sign is selected, but it's all good")
      } else {
        notes.push("Amending an existing sign")
        changesOld.push({object: {type: "node", node_id: tappedLocation.id as `${number}`}, set_tags: signTags})
        osmModify.push({
          tag: 'node',
          version: tappedLocation.properties.version,
          id: +(tappedLocation.id || 0),
          lon: tappedLocation.geometry.coordinates[0],
          lat: tappedLocation.geometry.coordinates[1],
          tags: signTags
        })
      }
    }
  }
  if (!highwayLocation) {
    line = 'none'
    notes.push(
        "Add a stop in its logical location by tapping the way roughly where the driver should stop, usually at the stop line.",)
  } else {
    if (highwayLocation.type === "Feature") {
      line = 'edit'
      if (highwayDirection === directionFromString(highwayLocation.properties.tags?.direction)) {
        notes.push("A stopping point is selected, but it's all good")
      } else {
        const highwayTags = {
          ...highwayLocation.properties.tags, "highway": "stop", ...(highwayDirection
              ? {"direction": highwayDirection}
              : {})
        }
        notes.push("Amending an existing sign")
        let version = highwayLocation.properties.version
        osmModify.push({
          tag: 'node',
          id: highwayLocation.properties.id,
          lat: highwayLocation.properties.lat,
          lon: highwayLocation.properties.lon,
          version: version,
          tags: highwayTags
        })
        changesOld.push({
          object: {type: "node", node_id: highwayLocation.id as `${number}`}, set_tags: highwayTags
        })
      }
    } else {
      line = 'new'
      const street = selectedWays.map(w => w.properties.tags?.name).filter(f => !!f)[0]
      notes.push("Adding a new stop line" + (street ? ` on ${street}` : ""))
      const newNodeId = `new-${+highwayLocation.way}` as const
      const signTags = {
        "highway": "stop", ...(highwayDirection ? {"direction": highwayDirection} : {})
      }
      osmCreate.push({
        tag: 'node',
        version: 0,
        id: versionIdNumber(newNodeId),
        lon: highwayLocation.point.geometry.coordinates[0],
        lat: highwayLocation.point.geometry.coordinates[1],
        tags: signTags
      })
      changesOld.push({
        object: {type: "node", position: highwayLocation.point.geometry.coordinates, node_id: newNodeId},
        set_tags: signTags
      })
      const selectedWay = selectedWays.find(w => highwayLocation.way)
      const waynodes = selectedWay?.properties.nodes
      if (selectedWay && waynodes) {
        const loc = Math.floor(highwayLocation.point.properties.location)
        const index = Math.floor(highwayLocation.point.properties.index) + 1
        const early = waynodes.slice(0, index)
        const late = waynodes.slice(index)
        const complete = [...early, versionIdNumber(newNodeId), ...late]
        console.log("the loc", loc, early, late, waynodes, complete, highwayLocation.point.properties, index)
        osmModify.push({
          id: Number(highwayLocation.way),
          nodes: complete.map(m => ({ref: m})),
          tag: "way",
          tags: selectedWay.properties.tags,
          version: selectedWay.properties.version
        })
        changesOld.push({
          object: {type: "way", way_id: highwayLocation.way as `${number}`, nodes: complete.map(m => m.toString())},
          set_tags: {}
        })

      }
    }
  }
  if (tappedLocation === null || highwayLocation === null) {
    notes.push(
        "You can also add or change existing nodes by tapping them: independent traffic signs are shown, as well as give way lines that might need to be corrected.")
  }
  const commentary: [string, string | undefined] = [
    sign === "new" ? "Add Stop Sign" : line === "new" ? "Add Stop" : sign === "edit" ? "Edit Stop Sign" : line
    === "edit" ? "Edit Stop" : "Add Stop Sign", on ? `On ${on}` : undefined]

  const osmChange: OsmChange = {
    version: "0.6", generator: user_agent, create: osmCreate, modify: osmModify, delete: osmDelete
  }
  return {signFaceAngle, changesOld, notes, commentary, osmChange}
}

const inferDirectionAndAngle = (
    signLocation: GeoJSON.Point | NearestPoint,
    selectedWays: GeoJSON.Feature<GeoJSON.LineString, object>[],
    waysOthers: PartialRecord<WayId, IntersectingWayInfo>
): {
  wayId: undefined | WayId /* direction is relative to wayId */,
  angle: undefined | number,
  direction: undefined | "forward" | "backward"
} => {
  const ways = selectedWays
  .map(way => {
    const nearestPointOnLine = turf.nearestPointOnLine(way, signLocation)
    const distance = turf.distance(nearestPointOnLine, signLocation)
    return {way, nearestPointOnLine, distance}
  })
  if (!ways) return {angle: undefined, direction: undefined, wayId: undefined}
  const closestWay = ways
  .sort(({distance: distance1}, {distance: distance2}) => distance1 - distance2)
      [0]
  if (!closestWay) return {angle: undefined, direction: undefined, wayId: undefined}
  const {way, nearestPointOnLine} = closestWay

  const angle = calculateAngleAtIndex(way, nearestPointOnLine.properties.index)
  const direction = calculateDirectionToNearestIntersection(
      closestWay,
      nearestPointOnLine.properties.index,
      waysOthers[way.id!.toString()]
  )

  return {angle, direction, wayId: closestWay.way.id as WayId}
}

const calculateAngleAtIndex = (way: GeoJSON.Feature<GeoJSON.LineString, object>, ix: number) => {
  const otherIx = ix + 1 >= way.geometry.coordinates.length ? ix - 1 : ix + 1
  const nextIx = Math.max(ix, otherIx)
  const prevIx = Math.min(ix, otherIx)
  const next = way.geometry.coordinates[nextIx]
  const prev = way.geometry.coordinates[prevIx]
  return bound(turf.rhumbBearing(prev, next), 0, 360)
}

const calculateDirectionToNearestIntersection = ({way, nearestPointOnLine}: {
  way: GeoJSON.Feature<GeoJSON.LineString, object>, nearestPointOnLine: TurfNearestPoint
}, ix: number, intersectedWays: IntersectingWayInfo | undefined) => {
  const wayIntersections: GeoJSON.Feature<GeoJSON.Point, { ix: number }>[] = (intersectedWays || []).flatMap((wna) => {
    return wna.others ? [
      {
        type: "Feature",
        properties: {ix: wna.ix},
        geometry: {type: "Point", coordinates: way.geometry.coordinates[wna.ix]}
      }] : []
  })
  if (!wayIntersections || !wayIntersections.length) return undefined
  const nearestIntersection = turf.nearestPoint(
      nearestPointOnLine,
      {type: "FeatureCollection", features: wayIntersections}
  )
  //const orientation = nodes?.filter(f => f.id == $node_id && (f.properties.tags || {})["direction"] ==
  // "backward").length ? 180 : 0
  const trueIx = ix
  if (nearestPointOnLine.properties.location === 0) return 'backward'
  if (nearestPointOnLine.properties.index === way.geometry.coordinates.length - 1) return 'forward'
  return trueIx < wayIntersections[nearestIntersection.properties.featureIndex].properties.ix ? 'forward' : 'backward'
}

const rmUndef = (r: PartialRecord<string, string | undefined>): Record<string, string> => {
  return Object.fromEntries(Object.entries(r).flatMap(([key, val]) => val === undefined ? [] : [[key, val]]))
}

const directionFromString = (maybeDirection: string | undefined | null | false): "forward" | "backward" | undefined => {
  switch (maybeDirection) {
    case "forward":
      return maybeDirection
    case "backward":
      return maybeDirection
    default:
      return undefined
  }
}

const a_includes_b = (a: PartialRecord<string, string>, b: PartialRecord<string, string>, isIncluded: ((
    key: string, a_value: string | undefined,
    b_value: string | undefined
) => boolean) | undefined = undefined): boolean => {
  return !Object.entries(b).some(([bkey, bval]) => isIncluded ? isIncluded(bkey, a[bkey], bval) : a[bkey] !== bval)
}

type FullyDefined<T> = Partial<{
  [key in keyof T]: Exclude<T[key], undefined>
}>

function removeUndefined<T extends object>(t: T): FullyDefined<T> {
  const filter = <K extends keyof T>(arg: [string | number | symbol, T[K]]): arg is [K, Exclude<T[K], undefined>] => arg[1]
      !== undefined
  return Object.fromEntries(Object.entries(t)
  .filter(filter)) as FullyDefined<T>
}
