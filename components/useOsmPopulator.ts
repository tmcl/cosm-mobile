import {useEffect, useState} from 'react'
import * as OsmApiJSON from "@/scripts/clients";
import {
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
import {Promise_never} from "@/components/utils";

/**
 * @param osmMapArgs - this is the bounds for which data should be queried from osm. it might be the loading bounds less some region for which cached data is available
 * @param unknownBoundsDone - this basically means that osmMapArgs is properly defined and the queries can run
 * @param invalidateSameRoads - how you will know when your information relating to same roads needs to be invalidated
 * @param runAfterInteractions - we need to recursively commit changes to the database to avoid overloading the system. this should be InteractionManager.runAfterInteractions to allow us to defer the recursion to a safe moment
 * @params
 */
export default (osmMapArgs: JsonBBox | undefined, unknownBoundsDone: boolean, invalidateSameRoads: () => void, runAfterInteractions: (f: () => void) => void) => {
 const queryClient =  useQueryClient()
  const queries = useOsmPopulatingQueries()
  const [osmMap, setOsmMapQ] = useState(initialQueryState<unknown, { $json: string; $requestedBounds: JsonBBox; }>())
  const [, setInsertBoundsQ] =useState(initialMutationState<unknown, void>())
  const [, setInsertNodesQ] =useState(initialMutationState<unknown, boolean>())
  const [, setInsertWaysQ] =useState(initialMutationState<unknown, boolean>())
  const [, setInsertRelatedWaysQ] =useState(initialMutationState<unknown, boolean>())
  const [, seUpdateCasingsQ] =useState(initialMutationState<unknown, boolean>())

  useDispatchingQuery(
      setOsmMapQ,
      {
        queryKey: ["osm map", osmMapArgs],
        enabled: unknownBoundsDone
            && !!osmMapArgs,
        queryFn: (async () => {
          if (!osmMapArgs) return Promise_never()
          return {
          $json: await OsmApiJSON.getApi06MapText(osmMapArgs),
          $requestedBounds: osmMapArgs
        }})
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
}

