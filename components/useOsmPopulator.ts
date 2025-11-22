import {useEffect, useState} from 'react'
import * as OsmApiJSON from "@/scripts/clients";
import {
  doublePad,
  JsonBBox,
} from '@/components/types';
import {
  initialMutationState,
  initialQueryState,
  useDispatchingMutation,
  useDispatchingQuery,
  useOsmPopulatingQueries,
} from '@/components/queries';
import {useQueryClient} from '@tanstack/react-query'
import type GeoJSON from "geojson";

export default (visibleBounds: JsonBBox|undefined, osmMapArgs: JsonBBox | undefined, unknownBoundsDone: boolean, invalidateSameRoads: () => void, runAfterInteractions: (f: () => void) => void) => {
 const queryClient =  useQueryClient()
  const queries = useOsmPopulatingQueries()
  const [osmMap, setOsmMapQ] = useState(initialQueryState<unknown, { $json: string; $requestedBounds: JsonBBox; }>())
  const [, setInsertBoundsQ] =useState(initialMutationState<unknown, void>())
  const [, setInsertNodesQ] =useState(initialMutationState<unknown, boolean>())
  const [, setInsertWaysQ] =useState(initialMutationState<unknown, boolean>())
  const [, setInsertRelatedWaysQ] =useState(initialMutationState<unknown, boolean>())
  const [, seUpdateCasingsQ] =useState(initialMutationState<unknown, boolean>())
  const [queryWays, setQueryWays] = useState(initialQueryState<unknown, {
    casings: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.LineString, OsmApiJSON.IWay> | null,
    centrelines: GeoJSON.FeatureCollection<GeoJSON.LineString, OsmApiJSON.IWay> | null
  }>())

  const doublePaddedBounds = visibleBounds && doublePad(visibleBounds)

  useDispatchingQuery(
      setOsmMapQ,
      {
        queryKey: ["osm map", osmMapArgs],
        enabled: unknownBoundsDone
            && !!osmMapArgs,
        queryFn: osmMapArgs ? (async () => ({
          $json: await OsmApiJSON.getApi06MapText(osmMapArgs),
          $requestedBounds: osmMapArgs
        })) : undefined
      })

  const qInsertNodes = useDispatchingMutation(
      setInsertNodesQ,
      {
        mutationFn: async (param: { $json: string }) => (await queries.current.doInsertNodes(param)),
        onSuccess: (changes) => {
          if (changes) {
            queryClient.invalidateQueries({queryKey: ["spatialite query nodes"]})
          }
        }
      }
  )

  const qUpdateCasings = useDispatchingMutation(
      seUpdateCasingsQ,
      {
        mutationFn: async () => (await queries.current.doAddCasingToWays()).changes > 0,
        onSuccess: (data) => {
          console.log("we have updated some casings: ", data)
          if (data) {
            queryClient.invalidateQueries({queryKey: ["spatialite query ways"]})
            queryClient.invalidateQueries({queryKey: ["spatialite", "nearby ways"]})
            runAfterInteractions(() => qUpdateCasings.mutate())
          }
        }
      }
  )

  const qInsertWays = useDispatchingMutation(
      setInsertWaysQ,
      {
        mutationFn: async (param: {
          $json: string
        }) => (await queries.current.doInsertWays(param)),
        onSuccess: (data) => {
          if (data) {
            queryClient.invalidateQueries({queryKey: ["spatialite query ways"]})
            queryClient.invalidateQueries({queryKey: ["spatialite", "nearby ways"]})
            qUpdateCasings.mutate()
            qInsertRelatedWays.mutate()
          }
        }
      }
  )

  const qInsertRelatedWays = useDispatchingMutation(
      setInsertRelatedWaysQ,
      {
        mutationFn: async () => (await queries.current.doInsertRelatedWays()) > 0,
        onSuccess: (data) => {
          if (data) {
            queryClient.invalidateQueries({queryKey: ["spatialite query ways"]})
            queryClient.invalidateQueries({queryKey: ["spatialite", "nearby ways"]})
            invalidateSameRoads()
          }
        }
      }
  )

  /* autotrigger mutations based on data state changes */
  const queryInsertRelatedWays = queries.current.insertRelatedWays
  const qInsertRelatedWaysMutate = qInsertRelatedWays.mutate
  useEffect(() => {
    if (!queryInsertRelatedWays) return
    qInsertRelatedWaysMutate()
  }, [queryInsertRelatedWays, qInsertRelatedWaysMutate])

  const qInsertBounds = useDispatchingMutation(
      setInsertBoundsQ,
      {
        mutationFn: async (args: {
          $json: string,
          $requestedBounds: JsonBBox
        }) => { await queries.current.doInsertBounds(args) },
        onSuccess: (data, variables,) => {
          queryClient.invalidateQueries({queryKey: ["spatialite known bounds", variables.$requestedBounds]})
        }
      }
  )

  const qInsertBoundsMutate   = qInsertBounds.mutate
  const qInsertNodesMutate    = qInsertNodes.mutate
  const qInsertWaysMutate     = qInsertWays.mutate
  useEffect(() => {
    const data = osmMap.data
    if (!data) return console.log("i won't run it because no data")
    console.log("no i'm going ot run it", data)
    qInsertBoundsMutate(data)
    qInsertNodesMutate(data)
    qInsertWaysMutate(data)
  }, [osmMap.status, osmMap.data, qInsertBoundsMutate, qInsertNodesMutate, qInsertWaysMutate])

  useDispatchingQuery(setQueryWays, {
    queryKey: ["spatialite query ways", (doublePaddedBounds || {})],
    enabled: !!doublePaddedBounds,
    placeholderData: (d) => d,
    queryFn: doublePaddedBounds ? (async () => {
      const result = await (queries.current.doQueryWays({...doublePaddedBounds, $limit: MAX_FEATURES_QUERY}))
      const casings = result.casings.length ? {type: "FeatureCollection" as const, features: result.casings} : null
      const centrelines = result.centrelines.length ? {
        type: "FeatureCollection" as const, features: result.centrelines
      } : null
      return {casings, centrelines}
    }) : () => new Promise(() => {})
  })

  return {queryWays}
}

export const MAX_FEATURES_QUERY = 3000
