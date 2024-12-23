import fromAsync from 'array-from-async';
import React, {useEffect, useReducer, useRef, useState} from 'react'
import {FAB} from '@rneui/themed'
import {InteractionManager, StyleSheet, Text, View} from "react-native";
import MapLibreGL from '@maplibre/maplibre-react-native';
import type {RegionPayload} from '@maplibre/maplibre-react-native/src/components/MapView';
import * as OsmApi from "@/scripts/clients";
import {useAndroidLocationPermission} from '@/components/AndroidLocationPermission';
import {
	bound,
	containsAll, debug,
	doublePad,
	initialMutationState,
	initialQueryState, InterestingNodes, InterestingNodesParams, IntersectingWayInfo,
	JsonBBox, lazy, MutationState, nub,
	QueryState, TargetNode, useDispatchingMutation,
	useDispatchingQuery,
	useMainPageQueries, WayId
} from '@/components/queries';
import type GeoJSON from "geojson";
import {skipToken, useQueryClient} from '@tanstack/react-query'
import * as Svg from "react-native-svg";
import {OnPressEvent} from "@maplibre/maplibre-react-native/src/types/OnPressEvent";
import {IconNode} from "@rneui/base";
import * as turf from "@turf/turf";

const MAX_FEATURES_QUERY = 3000

const roadStrokesLayerStyle = (wayIds: string[]|null): MapLibreGL.LineLayerStyle => ({
	lineColor: wayIds ? ["case", ["in", ["id"], ["literal", wayIds] ], "purple", "red"] : "red",
	lineOpacity: ["case", ["in", ["geometry-type"], ["literal", "LineString"]], 1, 0]
})

const roadcasingsLayerStyle = (wayIds: string[]|null): MapLibreGL.FillLayerStyle => ({
	fillColor: wayIds ? ["case", ["in", ["id"], ["literal", wayIds] ], "purple", "red"] : "red",
	fillOpacity: ["case", ["in", ["geometry-type"], ["literal", "Polygon"]], 0.98, 0]
})

const pointsOnWayNearClickLayerStyle = (nodeIds: string[]) : MapLibreGL.CircleLayerStyle => ({
	circleColor: ["case", ["in", ["id"], ["literal", nodeIds]], "blue", "gray"],
	circleOpacity: 1,
	circleStrokeWidth: 2,
	circleStrokeColor: "white",
	circleRadius: 5,
	circlePitchAlignment: "map"
})

const circleLayerStyle = (input: number|undefined): MapLibreGL.CircleLayerStyle => ({
	circleColor: input ? ["case", ["==", ["id"], input.toString() ], "yellow", "purple"] : "green",
	circleOpacity: 0.84,
	circleStrokeWidth: 2,
	circleStrokeColor: "white",
	circleRadius: 5,
	circlePitchAlignment: "map"
})



const styles = StyleSheet.create({
	fab1: {
		position: 'absolute',
		margin: 16,
		left: 0,
		bottom: 48
	},
	fab: {
		position: 'absolute',
		margin: 16,
		right: 0,
		bottom: 48
	},
	page: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		backgroundColor: '#F5FCFF',
	},
	map: {
		flex: 1,
		alignSelf: 'stretch',
	},
});

type Mode = Browse | AddStopSign
type Browse = 'browse'
type AddStopSign = 'add stop sign'

type State = {
	initialSetup: boolean,
	mode: Mode
	modes: {
		addStopSign: {
			tappedLocation: {newId: `new-${number}`, point: GeoJSON.Point, type: "new"} | TargetNode | null
			highwayLocation: {way: WayId, point: GeoJSON.Point} | TargetNode | null
			direction: "forward" | "backward" | undefined
		}
	}
	zoom: number
	centreCoordinates: GeoJSON.Position|undefined,
	selectedWays: WayId[]
	visibleBounds: {minlat: number, minlon: number, maxlat: number, maxlon: number}|undefined
	sameRoads: Record<WayId, WayId[]>
	intersections: Record<WayId, IntersectingWayInfo>
	queries: {
		queryNodes: QueryState<unknown, GeoJSON.FeatureCollection<GeoJSON.Point, OsmApi.INode> | null>
		queryWays: QueryState<unknown, {casings: GeoJSON.FeatureCollection<GeoJSON.Polygon|GeoJSON.LineString, OsmApi.IWay>|null, centrelines: GeoJSON.FeatureCollection<GeoJSON.LineString, OsmApi.IWay>|null}>
		interestingNodes: QueryState<unknown, InterestingNodes>
		osmCapabilities: QueryState<unknown, OsmApi.IApiCapabilities>
		osmVersions: QueryState<unknown, OsmApi.IJSONApiVersions>
		osmMap: QueryState<unknown, { $json: string; $requestedBounds: {minlat: number, minlon: number, maxlat: number, maxlon: number}; }>
		unknownBounds: QueryState<unknown, {minlat: number, minlon: number, maxlat: number, maxlon: number}|null>
		sameRoads: QueryState<unknown, Record<WayId, WayId[]>>
		intersections: QueryState<unknown, Record<WayId, IntersectingWayInfo>>
		insertBounds: MutationState<unknown, void>
		insertNodes: MutationState<unknown, boolean>
		insertWays: MutationState<unknown, boolean>
		insertRelatedWays: MutationState<unknown, boolean>
		updateCasings: MutationState<unknown, number>
	}
}

const initialState: State = {
	mode: 'browse',
	initialSetup: true,
	modes: { addStopSign: { tappedLocation: null, highwayLocation: null, direction: undefined } },
	selectedWays: [],
	visibleBounds: undefined,
	zoom: 14,
	centreCoordinates: undefined,
	sameRoads: {},
	intersections: {},
	queries: {
		queryNodes: initialQueryState(),
		queryWays: initialQueryState(),
		interestingNodes: initialQueryState(),
		unknownBounds: initialQueryState(),
		osmCapabilities: initialQueryState(),
		osmMap: initialQueryState(),
		osmVersions: initialQueryState(),
		insertBounds: initialMutationState(),
		insertNodes: initialMutationState(),
		insertWays: initialMutationState(),
		insertRelatedWays: initialMutationState(),
		updateCasings: initialMutationState(),
		sameRoads: initialQueryState(),
		intersections: initialQueryState(),
	}
}

type SelectWay = { action: "select ways", ways: WayId[], select: boolean|"toggle" }
type SetInitialSetup = { action: "post initial setup" }
type SetZoom = { action: "set zoom", zoom: number, centreCoordinates?: GeoJSON.Position }
type ActionAddStopSign = { action: "add stop sign", tappedLocation: null } | { action: "add stop sign", tappedLocation: GeoJSON.Point, id: `new-${number}` }
type SetVisibleBounds = { action: "set visible bounds", visibleBounds: JsonBBox }
type SetQuery<Query extends keyof State['queries']> = {action: "set query", query: Query, queryState: State['queries'][Query] }
type SetMode = { action: "set mode", mode: Mode}
type SelectInterestingPoint = {action: "select interesting point", mode: Mode, point: TargetNode}

type Action =
	  ActionAddStopSign
	| SelectInterestingPoint
	| SelectWay
	| SetVisibleBounds
	| SetZoom
	| SetInitialSetup
	| SetMode
	| {action: "invalidate same roads"}
	| {action: "invalidate intersections"}
	| SetQuery<"unknownBounds">
	| SetQuery<"osmCapabilities">
	| SetQuery<"interestingNodes">
	| SetQuery<"osmMap">
	| SetQuery<"queryNodes">
	| SetQuery<"queryWays">
	| SetQuery<"osmVersions">
	| SetQuery<"insertBounds">
	| SetQuery<"insertNodes">
	| SetQuery<"insertWays">
	| SetQuery<"insertRelatedWays">
	| SetQuery<"updateCasings">
	| SetQuery<"sameRoads">
	| SetQuery<"intersections">

const make_id = (() => {
	let id = 1
	return () => id++
})()

const reducer = (state: State, action: Action): State => {
	switch (action.action) {
		case "set mode": {
			return {...state, mode: action.mode}
		}
		case "select interesting point": {
			switch(action.mode) {
				case "browse": return state
				case "add stop sign": {
					if (action.point.properties.ways.length === 0
						&& action.point.properties.tags?.highway === undefined
						&& !state.modes.addStopSign.tappedLocation) {
						return {...state, modes: {...state.modes, addStopSign: {...state.modes.addStopSign, tappedLocation: action.point}}}
					} else if (action.point.properties.ways.length === 1) {
						if (!state.modes.addStopSign.highwayLocation) {
							return {
								...state,
								selectedWays: [...action.point.properties.ways],
								modes: {
									...state.modes,
									addStopSign: {...state.modes.addStopSign, highwayLocation: action.point}
								}
							}
						} else if ("type" in state.modes.addStopSign.highwayLocation && state.modes.addStopSign.highwayLocation.id === action.point.id) {
							return {
								...state,
								modes: {
									...state.modes,
									addStopSign: {...state.modes.addStopSign, highwayLocation: null}
								}
							}
						} else {
							return state
						}
					} else {
						return state
					}
				}
				default:
					const c: never = action.mode
					throw c
			}
		}
		case "invalidate same roads": {
			return {...state, sameRoads: {}}
		}
		case "invalidate intersections": {
			return {...state, intersections: {}}
		}
		case "post initial setup": {
		   return  state.initialSetup ? {...state, initialSetup: false } : state
		}
		case "set zoom": {
			console.log(action)
			return state.zoom === action.zoom ? state : {...state, zoom: action.zoom, centreCoordinates: action.centreCoordinates}
		}
		case "add stop sign": {
			return {...state, modes: {...state.modes, addStopSign: {...state.modes.addStopSign, tappedLocation: action.tappedLocation ? {type: "new", newId: action.id, point: action.tappedLocation} : null }}}
		}
		case "select ways": {
			const select = action.select === 'toggle' ? !containsAll(state.selectedWays, action.ways) : action.select
			const selectedWays = select ? Object.keys(Object.fromEntries([/* ...state.selectedWays,*/ ...action.ways].map(f => [f, true]))).sort() : state.selectedWays.filter(f => !action.ways.includes(f))
			return {...state, selectedWays}
		}
		case "set visible bounds": {
			if (!state.visibleBounds
				|| state.visibleBounds.minlat !== action.visibleBounds.minlat
				|| state.visibleBounds.minlon !== action.visibleBounds.minlon
				|| state.visibleBounds.maxlat !== action.visibleBounds.maxlat
				|| state.visibleBounds.maxlon !== action.visibleBounds.maxlon
			) {
				return {...state, visibleBounds: action.visibleBounds}
			} else {
				return state
			}
		}
		case "set query": {
			let otherChanges: Partial<State> = {}
			if(action.queryState.status === "error") {
				console.log("error", action)
			}
			switch (action.query) {
				case "intersections":
				case "sameRoads": {
					// this works when I can use the generic to narrow things down, but not otherwise.
					// therefore, it's a closure.
					// it copies the data from the action into the state and deletes some of the older information
					// so that we don't hold onto too much.
					const query = action.query
					const process = <T extends 'sameRoads'|'intersections'>(query: T) => {
						if (action.queryState.status === "success" && action.queryState.data) {
							const data = {...state[query], ...action.queryState.data}
							let unincluded = 0
							for (const key in data) {
								if(state.selectedWays.includes(key) || state.queries.queryWays.data?.casings?.features.find(f => f.id === key) || unincluded++ < 5 ) {
								} else {
									delete data[key]
								}
							}
							otherChanges[query] = data
					}
					}
					process(query)
					console.log("||||||||||||||", query, otherChanges, action, state)
					break;
				}
				case "queryWays":
					if(state.zoom < 20 && action.queryState.status === "success" && action.queryState.fetchStatus === "idle" && action.queryState.data?.casings?.features.length === MAX_FEATURES_QUERY) {
						console.log("because max features", action.queryState.data?.casings.features.length, "zooming", state.zoom+1)
						otherChanges.zoom = Math.floor(state.zoom)+1
					}
					break;
			}
			return {...state, queries: {...state.queries, [action.query]: action.queryState }, ...otherChanges}
		}
	}
}

function buildStatusString(queries: Record<string, MutationState<unknown, unknown>|QueryState<unknown, unknown>>) {
	const buildStatusStr = (m: MutationState<unknown, unknown>|QueryState<unknown, unknown>): [string, string] => {
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
		.sort(([k1, ] , [k2,]) => k1.localeCompare(k2))
		.map(([k, m]) => {
			const [status, color] = buildStatusStr(m)
			const identifier = k[0] + k.split('').filter(k => /[A-Z]/.test(k)).join('')
			return <Text key={k} style={{color}}>{identifier + status}</Text>
			}
		)
}

// noinspection JSUnusedGlobalSymbols default export is automatically included by expo-router
export default function MainPage() {
	/* standard/project effects */
	useAndroidLocationPermission(() => {})
	const queryClient = useQueryClient()
	const queries = useMainPageQueries()
	const [state, xdispatch] = useReducer(reducer, initialState)
	const dispatch = (a: Action) => { console.log("action", a.action, "query" in a && a.query); return xdispatch(a) }
	const refCamera = useRef<MapLibreGL.CameraRef>(null)
	const refHighwaystopSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const refPointsOnWayNearClickSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const refRoadcasingsSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const refMapView = useRef<MapLibreGL.MapViewRef|null>(null)
	const refTappedLoc = useRef<MapLibreGL.PointAnnotationRef>(null)

	/* simple synonoms */
	const visibleBounds = state.visibleBounds;
	const doublePaddedBounds = visibleBounds && doublePad(visibleBounds)
	const editableSign = state.mode === "add stop sign"
		? (state.modes.addStopSign.tappedLocation?.type === "Feature"
			? state.modes.addStopSign.tappedLocation.geometry : state.modes.addStopSign.tappedLocation?.point) : undefined

	const interestingPoints = state.queries.interestingNodes.data

	const mapArea = visibleBounds ? (visibleBounds.maxlon - visibleBounds.minlon) * (visibleBounds.maxlat - visibleBounds.minlat) : undefined
	const capability = state.queries.osmCapabilities.data?.api.area.maximum
	const osmMapArgs: JsonBBox|undefined = state.queries.unknownBounds.data || visibleBounds
	const symbols = state.queries.queryNodes.data || null
	const roadcasings = state.queries.queryWays.data?.casings || null

	const fab = true
	const [subFab, setSubFab] = useState(false)
	const statusString = buildStatusString(state.queries)

	const radians = undefined //todo implement this somehow.
	const highlightWays = nub(state.selectedWays.concat(state.selectedWays.flatMap(f => state.sameRoads[f] || [])))
	const activeWays = state.queries.queryWays.data?.centrelines?.features
		.filter(f => f.id && highlightWays.includes(f.id.toString()))
		|| []

	const interestingNodesParams = doublePaddedBounds && (() => {
		const params =  interestingNodesParamsFromMode(state)
		return params && {...params, ...doublePaddedBounds}
	})()
	const hasInterestingNodes = !!interestingNodesParams

	/* queries */
	{
		const neededIntersections = state.selectedWays.filter(f => !(f in state.intersections) || !state.intersections[f])
		useDispatchingQuery(
			(queryState: QueryState<unknown, Record<WayId, IntersectingWayInfo>>) => dispatch({
				action: "set query",
				query: "intersections",
				queryState
			}),
			{
				queryKey: ["spatialite", "ways", "intersections", neededIntersections],
				enabled: neededIntersections.length > 0,
				queryFn: () => queries.current.doFindIntersections(neededIntersections),
			}
		)
	}
	{
		const neededRoads = state.selectedWays.filter(f => !(f in state.sameRoads) || !state.sameRoads[f])
		useDispatchingQuery(
			(queryState: QueryState<unknown, Record<WayId, WayId[]>>) => dispatch({
				action: "set query",
				query: "sameRoads",
				queryState: queryState.data ? debug("this is a same roads query state", queryState) : queryState
			}),
			{
				queryKey: ["spatialite", "ways", "road ways", neededRoads],
				enabled: neededRoads.length > 0,
				queryFn: () => queries.current.doFindSameRoads(neededRoads),
			}
		)
	}
	useDispatchingQuery(
		(queryState: QueryState<unknown, InterestingNodes>) => dispatch({action: "set query", query: "interestingNodes", queryState}),
		{
			queryKey: ["spatialite", "nearby ways", interestingNodesParams],
			enabled: hasInterestingNodes,
			queryFn: interestingNodesParams ? (() => queries.current.doFindTargetNodes(interestingNodesParams)) : undefined
		})

	useDispatchingQuery(
		(queryState: QueryState<unknown, JsonBBox|null>) => dispatch({action: "set query", query: "unknownBounds", queryState}),
		{
			queryKey: ["spatialite known bounds", visibleBounds],
			enabled: !!mapArea && !!capability && !!visibleBounds && (mapArea * 10 <= capability),
			queryFn: visibleBounds ? async () => {
				const result = (await queries.current.doKnownBounds(visibleBounds))
				if (result && result.bbox) {
					const [minlon, minlat, maxlon, maxlat] = result.bbox
					return {minlon, minlat, maxlon, maxlat}
				} else {
					return null
				}
			}: skipToken
		})

	useDispatchingQuery(
		(queryState: QueryState<unknown, { $json: string; $requestedBounds: JsonBBox ; }>) => {
			const sha = queryState.data ? sha256(bytesToBase64(JSON.stringify(queryState.data))) : undefined
			console.log("***set query osmMap", queryState.status, queryState.fetchStatus, sha)
			dispatch({action: "set query", query: "osmMap", queryState})
		}
		,
		{
		queryKey: ["osm map", osmMapArgs],
		enabled: state.queries.unknownBounds.status === 'success' && !!state.queries.unknownBounds.data && !!osmMapArgs,
		queryFn: osmMapArgs ? (async () => ({$json: await OsmApi.getApi06MapText(osmMapArgs), $requestedBounds: osmMapArgs})): undefined
	})

	useDispatchingQuery(
		(queryState: QueryState<unknown, GeoJSON.FeatureCollection<GeoJSON.Point, OsmApi.INode> | null>) => dispatch({action: "set query", query: "queryNodes", queryState})
		, {
			queryKey: ["spatialite query nodes", (doublePaddedBounds || {})],
			enabled: !!doublePaddedBounds,
			queryFn: doublePaddedBounds && (async ():Promise<GeoJSON.FeatureCollection<GeoJSON.Point, OsmApi.INode> | null> => {
				const nodes = await fromAsync(queries.current.doQueryNodes(doublePaddedBounds))
				return nodes.length ? {type: "FeatureCollection", features: nodes} : null
			})
		})

	useDispatchingQuery(
		(queryState) => dispatch({action: "set query", query: "queryWays", queryState}),
		{
			queryKey: ["spatialite query ways", (doublePaddedBounds || {})],
			enabled: !!doublePaddedBounds,
			placeholderData: (d) => d,
			queryFn: doublePaddedBounds && (async (): Promise<GeoJSON.FeatureCollection<GeoJSON.Polygon|GeoJSON.LineString, OsmApi.IWay>|null> => {
				const ways = await fromAsync(queries.current.doQueryWays({... doublePaddedBounds, $limit: MAX_FEATURES_QUERY}))
				return ways.length ? {type: "FeatureCollection", features: ways } : null
			queryFn: doublePaddedBounds && (async () => {
				const result = await (queries.current.doQueryWays({... doublePaddedBounds, $limit: MAX_FEATURES_QUERY}))
				const casings =  result.casings.length ? {type: "FeatureCollection" as const, features: result.casings } : null
				const centrelines =  result.centrelines.length ? {type: "FeatureCollection" as const, features: result.centrelines } : null
				return {casings, centrelines}
			})
		})
	useDispatchingQuery(
		(queryState: QueryState<unknown, OsmApi.IJSONApiVersions>) => dispatch({action: "set query", query: "osmVersions", queryState}),
		{
			queryKey: ['osm query version'],
			queryFn: OsmApi.getApiVersions,
			staleTime: 7*24*60*60*1000,
			placeholderData: (prev) => (prev || {api: {versions: ["0.6" as const]}})
		})

	useDispatchingQuery(
		(queryState: QueryState<unknown, OsmApi.IApiCapabilities>) => dispatch({action: "set query", query: "osmCapabilities", queryState}),
		{
			queryKey: ['osm query capabilities', state.queries.osmVersions.data],
			enabled: state.queries.osmVersions.status === 'success' && state.queries.osmVersions.data.api.versions.includes("0.6"),
			queryFn: OsmApi.getApi06Capabilities,
			staleTime: 7*24*60*60*1000,
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
						database: "offline" as const,
						api: "offline" as const,
						gpx: "offline" as const,
					}
				},
				policy: {imagery: {blacklist: []}},
			} )
		})

	/* mutations */
	const qInsertBounds = useDispatchingMutation(
		(queryState: MutationState<unknown, void>) => dispatch({action: "set query", query: "insertBounds", queryState}),
		{
		mutationFn: async (args: {$json: string, $requestedBounds: JsonBBox}) => { await queries.current.doInsertBounds(args) },
		onSuccess: (data, variables, ) => {
			queryClient.invalidateQueries({queryKey: ["spatialite known bounds", variables.$requestedBounds]})
		}
	})

	const qInsertNodes = useDispatchingMutation(
		(queryState: MutationState<unknown, boolean>) => dispatch({action: "set query", query: "insertNodes", queryState}),
		{
		mutationFn: async (param: { $json: string }) => (await queries.current.doInsertNodes(param)).changes > 0,
		onSuccess: (changes ) => {
			if(changes) {
				queryClient.invalidateQueries({queryKey: ["spatialite query nodes"]})
			}
		}
	})

	const qInsertWays = useDispatchingMutation(
		(queryState: MutationState<unknown, boolean>) => dispatch({action: "set query", query: "insertWays", queryState}),
		{
		mutationFn: async (param: { $json: string }) => (await queries.current.doInsertWays(param)).filter(d => d.changes).length > 0,
		onSuccess: (data) => {
			if(data) {
				queryClient.invalidateQueries({queryKey: ["spatialite query ways"]})
				queryClient.invalidateQueries({queryKey: ["spatialite", "nearby ways"]})
				qUpdateCasings.mutate()
				qInsertRelatedWays.mutate()
			}
		}
	})

	const qInsertRelatedWays = useDispatchingMutation(
		(queryState: MutationState<unknown, boolean>) => dispatch({action: "set query", query: "insertRelatedWays", queryState}),
		{
		mutationFn: async () => (await queries.current.doInsertRelatedWays()) > 0,
		onSuccess: (data) => {
			if(data) {
				queryClient.invalidateQueries({queryKey: ["spatialite query ways"]})
				queryClient.invalidateQueries({queryKey: ["spatialite", "nearby ways"]})
				dispatch({action: "invalidate same roads"})
			}
		}
	})

	const qUpdateCasings = useDispatchingMutation(
		(queryState: MutationState<unknown, number>) => dispatch({action: "set query", query: "updateCasings", queryState}),
		{
		mutationFn: async () => (await queries.current.doAddCasingToWays()).changes,
		onSuccess: (data) => {
			console.log("we have updated some casings: ", data)
			if(data) {
				queryClient.invalidateQueries({queryKey: ["spatialite query ways"]})
				queryClient.invalidateQueries({queryKey: ["spatialite", "nearby ways"]})
				InteractionManager.runAfterInteractions(() => qUpdateCasings.mutate())
			}
		}
	})

	/* autotrigger mutations based on data state changes */
	useEffect(() => {
		if(!queries.current.insertRelatedWays) return
		qInsertRelatedWays.mutate()
	}, [queries.current.insertRelatedWays])

	useEffect(() => {
		console.log("considering running the osm map trigger", state.queries.osmMap.status, state.queries.osmMap.data && sha256(bytesToBase64(JSON.stringify(state.queries.osmMap.data))))
		if(state.queries.osmMap.status !== 'success') return console.log("i won't run it because", state.queries.osmMap.status)
	 	const data = state.queries.osmMap.data
	 	if (!data) return console.log("i won't run it because no data")
		console.log("no i'm going ot run it")
	 	qInsertBounds.mutate(data)
	 	qInsertNodes.mutate(data)
	 	qInsertWays.mutate(data)
	}, [state.queries.osmMap.status, state.queries.osmMap.data])

	/* callbacks */
	const setTappedLocation = (tappedLocation: GeoJSON.Point|null, toggle = false) => {
		switch(state.mode) {
			case "add stop sign":
				const loc = toggle && state.modes.addStopSign.tappedLocation ? null : tappedLocation
				return dispatch(loc ? {action: "add stop sign", tappedLocation: loc, id: `new-${make_id()}`} : {action: "add stop sign", tappedLocation: loc})
			case "browse":
				return;
		}
	}
	const onPressMap = (event: GeoJSON.Feature<GeoJSON.Point>) => { console.log("from map", event); setTappedLocation(event.geometry, true)}
	const onPressWay = (event: OnPressEvent) => { console.log("from way", event); dispatch({action: "select ways", ways: event.features.map(i => i.id!.toString()), select: "toggle"}) }

	const onMapBoundChange = (feature: GeoJSON.Feature<GeoJSON.Point, RegionPayload>) => {
		console.log('+++++++++++++++observed map bounds change', feature)
		const [ne, sw] = feature.properties.visibleBounds
		const maxlon = ne[0]
		const maxlat = ne[1]
		const minlon = sw[0]
		const minlat = sw[1]
		dispatch({ action: "set visible bounds", visibleBounds: {minlon, minlat, maxlon, maxlat}})
		if(feature.properties.zoomLevel !== 14 || feature.properties.isUserInteraction || !state.initialSetup) // repeated setting of zoom level at initiation
		{
			console.log("setting becaues ....", feature.properties.zoomLevel, feature.properties.isUserInteraction, state.initialSetup)
			dispatch({action: "set zoom", centreCoordinates: feature.geometry.coordinates, zoom: feature.properties.zoomLevel})
		} else {
			console.log("not setting becaues ....", feature.properties.zoomLevel, feature.properties.isUserInteraction, state.initialSetup)
		}
	}

	useEffect(
		() => {
			if (state.initialSetup) {
				setTimeout(() => dispatch({ action: "post initial setup" }), 30_000)
			}
		},
		[]
	)

	const [defaultOptionText, defaultOptionIcon, subfabs] = fabFromMode(state.mode)
	const fabButtonPress = () => {
		switch (state.mode) {
			case "browse": return setSubFab(!subFab)
			case "add stop sign": return console.log("need to support adding signs")
		}
	}
	const fabButtonLongPress = () => { setSubFab(true) }

	const onPressSelectInterestingPoint = (e: OnPressEvent) => {
		const features: (GeoJSON.Feature<GeoJSON.Geometry, unknown>)[] = e.features
		console.log("an interesting point has been selected!", e)
		if(features.length === 1) {
			const feature = features[0]
			if(feature.geometry.type === "Point") {
				dispatch({action: "select interesting point", mode: state.mode, point: feature as TargetNode})
			}
		} else if (features.length > 1) {
			dispatch({action: "set zoom", zoom: state.zoom+2})
		}
		features.forEach(f => console.log("properties", f.properties))
	}

	const notes = modalNotes(state, activeWays)

	const selectedInterestingPoints = selectedInterestingPointsForMode(state)

	return (
		<View
			style={styles.page}
		>
			<View style={{flexDirection: "row", gap: 2}}>{statusString}</View>
			<MapLibreGL.MapView
				onRegionDidChange={onMapBoundChange}
				ref={refMapView}
				style={styles.map}
				logoEnabled={false}
				styleURL="https://tiles.openfreemap.org/styles/liberty"
				onPress={onPressMap}
			>
				{interestingPoints && <MapLibreGL.ShapeSource
					id="interestingPoints"
					shape={interestingPoints}
					ref={refPointsOnWayNearClickSource}
					onPress={onPressSelectInterestingPoint}
				>
					<MapLibreGL.CircleLayer
						id="pointsOnWayNearClicks"
						style={pointsOnWayNearClickLayerStyle(selectedInterestingPoints)}
					/>

				</MapLibreGL.ShapeSource>}
				{symbols && <MapLibreGL.ShapeSource
					id="highwaystop"
					shape={symbols}
					ref={refHighwaystopSource}
				>
					<MapLibreGL.CircleLayer
						id="points"
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
						style={roadcasingsLayerStyle(highlightWays)}
					/>
					<MapLibreGL.LineLayer
						id="roadstrokeslines"
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
				{editableSign && <MapLibreGL.PointAnnotation key={radians} ref={refTappedLoc} onSelected={() => setTappedLocation(null)} onDragEnd={e => setTappedLocation(e.geometry)} id="centrepoint" coordinate={editableSign.coordinates} draggable={true} >
					<View>
						<Svg.Svg  height="25" width="25" viewBox="0 0 100 100" >
							<Svg.Defs>
								<Svg.Marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto">
									<Svg.Path d="M 0 0 L 10 5 L 0 10 z" />
								</Svg.Marker>
							</Svg.Defs>
							<Svg.Circle cx="50" cy="50" r="43" stroke="blue" strokeWidth="14" fill="green" />
							{radians !== undefined ?
								<Svg.Line
									markerEnd='url(#arrow)'
									stroke={radians !== 0 ? "orange" : "black"} strokeWidth="10"
									x1={50 + (43) * Math.cos(radians+Math.PI)} y1={50 + (43) * Math.sin(radians+Math.PI)}
									x2={50 + (43) * Math.cos(radians)} y2={50 + (43) * Math.sin(radians)}></Svg.Line>
								:  false }
						</Svg.Svg>
					</View>
				</MapLibreGL.PointAnnotation>}

			</MapLibreGL.MapView>
			{notes.notes.length > 0 &&
				<View style={{left: 0, top: 0, margin: 16, padding: 16, backgroundColor: "#f0edeecc", position: "absolute"}}>
					{notes.notes.map((note, i) => <Text key={i}>{note}</Text>)}
					{notes.changes.map((note, i) => <Text style={{fontFamily: "monospace"}} key={i}>{JSON.stringify(note)}</Text>)}
				</View>
			}
			<View
				style={{
					right: 0,
					alignItems: "flex-end",
					position: 'absolute',
					margin: 16,
					rowGap: 32,
					bottom: 0,
				}}
			>
				{subfabs.map(({icon, mode, text}) =>
					<FAB
						key={mode}
						visible={subFab}
						onPress={() => {setSubFab(false); dispatch({action: "set mode", mode})}}
						title={text}
						icon={icon}
						color="orange"
					/>
				)}
			<FAB
				visible={fab}
				onPress={fabButtonPress}
				onLongPress={fabButtonLongPress}
				title={defaultOptionText}
				icon={defaultOptionIcon}
				color="orange"
			/></View>
		</View>
	);
}

const fabFromMode = (mode: Mode): [string|undefined, IconNode, {icon: IconNode, text: string|undefined, mode: Mode}[]] => {
	switch (mode) {
		case "browse":
			return [undefined, {name: "menu", color: "white", type: "material-community"}, [{icon: {name: "octagon", color: "white", type: "material-community"}, text: "Stop", mode: "add stop sign"}]]
		case "add stop sign":
			return ["Add Stop Sign", {name: "octagon", color: "white", type: "material-community"}, [{icon: {name: "cancel", color: "white", type: "material"}, text: "Cancel", mode: "browse"}]]
	}
}

const sha256: ((ascii: string) => string|undefined) = function sha256(ascii: string): string {
    function rightRotate(value: number, amount: number) {
        return (value>>>amount) | (value<<(32 - amount));
    }

    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    const lengthProperty = 'length'
    var i, j; // Used as a counter across the whole file
    var result = ''

    var words: number[] = [];
    var asciiBitLength = ascii[lengthProperty]*8;

    /* caching results is optional - remove/add slash from front of this line to toggle
    // Initial hash value: first 32 bits of the fractional parts of the square roots of the first 8 primes
    // (we actually calculate the first 64, but extra values are just ignored)
    var hash: number[] = sha256h.h = sha256h.h || [];
    // Round constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes
    var k: number[] = sha256h.k = sha256h.k || [];
    var primeCounter = k[lengthProperty];
    /*/
    var hash: number[] = [], k: number[] = [];
    var primeCounter = 0;
    //*/

    var isComposite: Record<number, number> = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
            for (i = 0; i < 313; i += candidate) {
                isComposite[i] = candidate;
            }
            hash[primeCounter] = (mathPow(candidate, .5)*maxWord)|0;
            k[primeCounter++] = (mathPow(candidate, 1/3)*maxWord)|0;
        }
    }

    ascii += '\x80' // Append Ƈ' bit (plus zero padding)
    while (ascii[lengthProperty]%64 - 56) ascii += '\x00' // More zero padding
    for (i = 0; i < ascii[lengthProperty]; i++) {
        j = ascii.charCodeAt(i);
        if (j>>8) throw ["character out of range", i, j]; // ASCII check: only accept characters in range 0-255
        words[i>>2] |= j << ((3 - i)%4)*8;
    }
    words[words[lengthProperty]] = ((asciiBitLength/maxWord)|0);
    words[words[lengthProperty]] = (asciiBitLength)

    // process each chunk
    for (j = 0; j < words[lengthProperty];) {
        var w = words.slice(j, j += 16); // The message is expanded into 64 words as part of the iteration
        var oldHash = hash;
        // This is now the undefinedworking hash", often labelled as variables a...g
        // (we have to truncate as well, otherwise extra entries at the end accumulate
        hash = hash.slice(0, 8);

        for (i = 0; i < 64; i++) {
            var i2 = i + j;
            // Expand the message into 64 words
            // Used below if
            var w15 = w[i - 15], w2 = w[i - 2];

            // Iterate
            var a = hash[0], e = hash[4];
            var temp1 = hash[7]
                + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) // S1
                + ((e&hash[5])^((~e)&hash[6])) // ch
                + k[i]
                // Expand the message schedule if needed
                + (w[i] = (i < 16) ? w[i] : (
                        w[i - 16]
                        + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15>>>3)) // s0
                        + w[i - 7]
                        + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2>>>10)) // s1
                    )|0
                );
            // This is only used once, so *could* be moved below, but it only saves 4 bytes and makes things unreadble
            var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) // S0
                + ((a&hash[1])^(a&hash[2])^(hash[1]&hash[2])); // maj

            hash = [(temp1 + temp2)|0].concat(hash); // We don't bother trimming off the extra ones, they're harmless as long as we're truncating when we do the slice()
            hash[4] = (hash[4] + temp1)|0;
        }

        for (i = 0; i < 8; i++) {
            hash[i] = (hash[i] + oldHash[i])|0;
        }
    }

    for (i = 0; i < 8; i++) {
        for (j = 3; j + 1; j--) {
            var b = (hash[i]>>(j*8))&255;
            result += ((b < 16) ? 0 : '') + b.toString(16);
        }
    }
	console.log("hash result")
    return result;
};

function bytesToBase64(str: string) {
	const bytes = new TextEncoder().encode(str)
  const binString = Array.from(bytes, (byte) =>
    String.fromCodePoint(byte),
  ).join("");
  return btoa(binString);
}

const selectedInterestingPointsForMode = (state: State): string[] => {
	switch (state.mode) {
		case "browse": return []
		case "add stop sign": return [
			state.modes.addStopSign.tappedLocation?.type === "Feature" && state.modes.addStopSign.tappedLocation.id?.toString(),
			state.modes.addStopSign.highwayLocation && "type" in state.modes.addStopSign.highwayLocation && state.modes.addStopSign.highwayLocation.id?.toString()
		].flatMap(m => m ? [m] : [])
	}
}

const interestingNodesParamsFromMode = (state: State): undefined|Omit<InterestingNodesParams, 'minlon'|'minlat'|'maxlon'|'maxlat'> => {
	switch (state.mode) {
		case "browse": return undefined
		case "add stop sign": return {$needles: [{"highway": "stop"}, {"traffic_sign": "stop"}, {"highway": "give_way"}, {"highway": "giveway"}]}
	}
}

type OsmObject =
	{ type: "way", way_id: `${number}`, nodes?: string[] }
	| { type: "way", way_id: `new-${number}`, nodes: string[] }
	| { type: "node", node_id: `${number}`, position?: GeoJSON.Position }
    | { type: "node", node_id: `new-${number}`, position: GeoJSON.Position }

const directionFromString = (maybeDirection: string|undefined|null|false): "forward"|"backward"|undefined => {
	switch (maybeDirection)
	{
		case "forward": return maybeDirection
		case "backward": return maybeDirection
		default: return undefined
	}
}

const calculateAngleAtIndex = (way: GeoJSON.Feature<GeoJSON.LineString, {}>, ix: number) => {
	const otherIx = ix + 1 >= way.geometry.coordinates.length ? ix - 1 : ix + 1
	const nextIx = Math.max(ix, otherIx)
	const prevIx = Math.min(ix, otherIx)
	const next = way.geometry.coordinates[nextIx]
	const prev = way.geometry.coordinates[prevIx]
	return bound(turf.rhumbBearing(prev, next), 0, 360)
}

const calculateDirectionToNearestIntersection = (
	{way, nearestPointOnLine}: {way: GeoJSON.Feature<GeoJSON.LineString, {}>, nearestPointOnLine: TurfNearestPoint},
	ix: number,
	intersectedWays: IntersectingWayInfo|undefined
	) => {
	const wayIntersections: GeoJSON.Feature<GeoJSON.Point, {ix: number}>[] =
		(intersectedWays || []).flatMap((wna) => {
			return wna.others
				? [{type: "Feature", properties: {ix: wna.ix}, geometry: {type: "Point", coordinates: way.geometry.coordinates[wna.ix]}}]
				: []
		})
	if(!wayIntersections || !wayIntersections.length) return undefined
	console.log("theoretically nearest point", nearestPointOnLine)
	console.log("wayintersections", wayIntersections)
	const nearestIntersection = turf.nearestPoint(nearestPointOnLine, {type: "FeatureCollection", features: wayIntersections})
	//const orientation = nodes?.filter(f => f.id == $node_id && (f.properties.tags || {})["direction"] == "backward").length ? 180 : 0
	const trueIx = ix
	if (nearestPointOnLine.properties.location === 0) return 'backward'
	if (nearestPointOnLine.properties.index  === way.geometry.coordinates.length - 1) return  'forward'
	return trueIx < wayIntersections[nearestIntersection.properties.featureIndex].properties.ix ? 'forward' : 'backward'
}

const inferDirectionAndAngle = (signLocation: GeoJSON.Point, selectedWays: GeoJSON.Feature<GeoJSON.LineString, {}>[], waysOthers: Record<WayId, IntersectingWayInfo>): {angle: undefined|number, direction: undefined|"forward"|"backward"} => {
	const ways = selectedWays
		.map(way => {
			const nearestPointOnLine = turf.nearestPointOnLine(way, signLocation)
			const distance = turf.distance(nearestPointOnLine, signLocation)
			return {way, nearestPointOnLine, distance}
		})
	if (!ways) return {angle: undefined, direction: undefined}
	const closestWay = ways
		.sort(({distance: distance1}, {distance: distance2}) => distance1 - distance2)
		[0]
	if (!closestWay) return {angle: undefined, direction: undefined}
	const {way, nearestPointOnLine} = closestWay

	const angle = calculateAngleAtIndex(way, nearestPointOnLine.properties.index)
	const direction = calculateDirectionToNearestIntersection(closestWay, nearestPointOnLine.properties.index, waysOthers[way.id!.toString()])

	return {angle, direction}
}

const modalNotes = (state: State, selectedWays: GeoJSON.Feature<GeoJSON.LineString, {}>[]): {changes: {object: OsmObject, tags: Record<string, string>}[], notes: string[]} => {
	switch (state.mode) {
		case "add stop sign":
			const notes = []
			const changes: {object: OsmObject, tags: Record<string, string>}[] = []

			const tappedLocation = state.modes.addStopSign.tappedLocation;
			const tappedLocationPoint = tappedLocation ? ( tappedLocation.type === "new" ? tappedLocation.point : tappedLocation.geometry) : undefined
			const highwayLocation = state.modes.addStopSign.highwayLocation;
			const highwayLocationPoint = highwayLocation ? ( "type" in highwayLocation  ? highwayLocation.geometry : highwayLocation.point) : undefined

			const inferredSignDirectionAndAngle = tappedLocationPoint ?
				lazy(() => inferDirectionAndAngle(tappedLocationPoint, selectedWays, state.intersections))
				: () => ({angle: undefined, direction: undefined})
			const inferredHighwayDirectionAndAngle = highwayLocationPoint ?
				lazy(() => inferDirectionAndAngle(highwayLocationPoint, selectedWays, state.intersections))
				: () => ({angle: undefined, direction: undefined})
			const highwayDirection = state.modes.addStopSign.direction
				|| directionFromString(highwayLocation && "type" in highwayLocation && highwayLocation.properties.tags?.direction)
				|| inferredHighwayDirectionAndAngle().direction
			if(!tappedLocation) {
				notes.push("Add a stop sign in its physical location by tapping the map where the sign is.",)
			} else {
				if(tappedLocation.type === "new") {
					notes.push("Adding a new stop sign")
					changes.push({object: {type: "node", position: tappedLocation.point.coordinates, node_id: tappedLocation.newId}, tags: rmUndef({direction: inferredSignDirectionAndAngle().angle?.toString(), "traffic_sign": "stop"})})
				} else if(tappedLocation.type === "Feature") {
					if (tappedLocation.properties.tags?.traffic_sign === "stop") {
						notes.push("A sign is selected, but it's all good")
					} else {
						notes.push("Amending an existing sign")
						changes.push({object: {type: "node", node_id: tappedLocation.id as `${number}`}, tags: {...tappedLocation.properties.tags, "traffic_sign": "stop"}})
					}
				}
			}
			if(!highwayLocation) {
				notes.push(
					"Add a stop in its logical location by tapping the way roughly where the driver should stop, usually at the stop line.",
				)
			} else {
				if("type" in highwayLocation) {
					if(highwayDirection === directionFromString(highwayLocation.properties.tags?.direction)) {
						notes.push("A stopping point is selected, but it's all good")
					} else {
						notes.push("Amending an existing sign")
						changes.push({object: {type: "node", node_id: highwayLocation.id as `${number}`}, tags: {...highwayLocation.properties.tags, "highway": "stop", ...(highwayDirection ? {"direction": highwayDirection} : {})}})
					}
				} else {
					notes.push("Adding a new stop sign")
				}
			}
			if(tappedLocation === null || highwayLocation === null) {
				notes.push(
					"You can also add or change existing nodes by tapping them: independent traffic signs are shown, as well as give way lines that might need to be corrected."
				)
			}
			return {changes, notes}
		case "browse":
			return {changes: [], notes: []}
	}
}

type TurfNearestPoint = GeoJSON.Feature<GeoJSON.Point, {
	dist: number;
	index: number;
	location: number;
}>
type NearestPoint = GeoJSON.Feature<GeoJSON.Point, {
	dist: number;
	index: number;
	location: number;
	triggeringWayId: WayId;
	segmentWayId: WayId;
}>

const rmUndef = (r: Record<string, string|undefined>): Record<string, string> => {
	return Object.fromEntries(Object.entries(r).flatMap(([key, val]) => val === undefined ? [] : [[key, val]]))
}