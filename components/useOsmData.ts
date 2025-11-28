import isEqual from 'lodash/isEqual'
import {useCallback, useState} from 'react'
import * as OsmApiJSON from "@/scripts/clients";
import {
  doublePad, JsonBBox, WayId, PartialRecord, IntersectingWayInfo, nub, debug
} from '@/components/types';
import {
  initialQueryState, QueryState, useDispatchingQuery, useOsmDataQueries,
} from '@/components/queries';
import type GeoJSON from "geojson";

export type WaysInfo = {
  casings: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.LineString, OsmApiJSON.IWay> | null,
  centrelines: GeoJSON.FeatureCollection<GeoJSON.LineString, OsmApiJSON.IWay> | null
}

/**
 * @param params.visibleBounds - this is the bounds for which data should be loaded. it might be the visible bounds
 *     plus some padding
 */
export default (params: {
  loadingBounds: JsonBBox | undefined,
  isWaySelected: (wayId: WayId) => boolean,
  withNewWays: (f: QueryState<unknown, WaysInfo>) => void,
  interestingWays: WayId[] | undefined,
  intersections: PartialRecord<WayId, IntersectingWayInfo>,
  sameRoads: PartialRecord<WayId, WayId[]>,
  setIntersections: (p: PartialRecord<WayId, IntersectingWayInfo>) => void,
  setSameRoads: (p: PartialRecord<WayId, WayId[]>) => void,
}) => {

  const queries = useOsmDataQueries()
  const [queryWays, setQueryWays_] = useState(initialQueryState<unknown, WaysInfo>())
  const [queryIntersections, setQueryIntersections_] = useState(initialQueryState<unknown, PartialRecord<WayId, IntersectingWayInfo>>())
  const [querySameRoads, setQuerySameRoads_] = useState(initialQueryState<unknown, PartialRecord<WayId, WayId[]>>())

  const processableState = {intersections: params.intersections, sameRoads: params.sameRoads}
  const updatableState = {intersections: params.setIntersections, sameRoads: params.setSameRoads}

  const process = <T extends keyof typeof updatableState>(queryState: QueryState<unknown, unknown>, query: T) => {
    if (queryState.status === "success" && queryState.data) {
      const data = {...processableState[query], ...queryState.data}
      let unincluded = 0
      for (const key in data) {
        if (params.isWaySelected(key)
            || queryWays.data?.casings?.features.find(f => f.id === key)
            || unincluded++
            < 5) {
        } else {
          delete data[key]
        }
      }
      updatableState[query](data as any /* trust me bru */)
    }
  }

  const setQueryIntersections = (queryState: QueryState<unknown, PartialRecord<WayId, IntersectingWayInfo>>) => {
    const isChanged = !isEqual(queryIntersections, queryState)
    console.log(
        "queryinteresections equality check",
        isChanged,
        queryIntersections === queryState,
        queryIntersections,
        queryState
    )
    isChanged && setQueryIntersections_(queryState)
    isChanged && process(queryState, 'intersections')
  }
  const setQuerySameRoads = (queryState: QueryState<unknown, PartialRecord<WayId, WayId[]>>) => {
    const isChanged = !isEqual(querySameRoads, queryState)
    isChanged && setQuerySameRoads_(queryState)
    isChanged && process(queryState, 'sameRoads')
  }

  const interestingWays = params.interestingWays || []
  console.log('the params iw', interestingWays && JSON.stringify(interestingWays).substring(0, 15))

  {
    const neededIntersections = interestingWays.filter(f => !(f in params.intersections)
        || !params.intersections[f])
    useDispatchingQuery(setQueryIntersections, {
      queryKey: ["spatialite", "ways", "intersections", neededIntersections],
      enabled: neededIntersections.length > 0,
      queryFn: () => queries.current.doFindIntersections(neededIntersections),
    })
  }
  {
    const relatedWays = Object.values(params.sameRoads).flatMap(f => f || [])
    const neededRoads = nub(relatedWays.concat(interestingWays.filter(f => !(f in params.sameRoads)
        || !params.sameRoads[f])))
    useDispatchingQuery(setQuerySameRoads, {
      queryKey: ["spatialite", "ways", "road ways", JSON.stringify(neededRoads)],
      enabled: neededRoads.length > 0,
      queryFn: () => queries.current.doFindSameRoads(neededRoads),
    })
    console.log("interesting ways are", interestingWays)
    console.log("related ways ways are", relatedWays)
    console.log("needed roads", neededRoads)
  }
  const setQueryWays = (q: QueryState<unknown, WaysInfo>) => {
    const isChanged = !isEqual(queryWays, q)
    isChanged && setQueryWays_(q)
    isChanged && params.withNewWays && params.withNewWays(q)
  }


  const loadingBounds = params.loadingBounds
  useDispatchingQuery(setQueryWays, {
    queryKey: ["spatialite query ways", (loadingBounds || {})],
    enabled: !!loadingBounds,
    placeholderData: (d) => d,
    queryFn: loadingBounds ? (async () => {
      const result = await (queries.current.doQueryWays({...loadingBounds, $limit: MAX_FEATURES_QUERY}))
      const casings = result.casings.length ? {type: "FeatureCollection" as const, features: result.casings} : null
      const centrelines = result.centrelines.length ? {
        type: "FeatureCollection" as const, features: result.centrelines
      } : null
      return {casings, centrelines}
    }) : () => new Promise(() => {})
  })

}
export const MAX_FEATURES_QUERY = 3000
