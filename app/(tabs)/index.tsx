import fromAsync from 'array-from-async';
import React, {useEffect, useReducer, useRef} from 'react'
import {FAB} from '@rneui/themed'
import {InteractionManager, StyleSheet, Text, View} from "react-native";
import {router} from "expo-router";
import MapLibreGL from '@maplibre/maplibre-react-native';
import type {RegionPayload} from '@maplibre/maplibre-react-native/src/components/MapView';
import * as OsmApi from "@/scripts/clients";
import {useAndroidLocationPermission} from '@/components/AndroidLocationPermission';
import {prepareSignArgs} from '../Add sign';
import {
	containsAll,
	doublePad,
	FoundNearbyWays, initialMutationState,
	initialQueryState,
	JsonBBox, MutationState,
	QueryState, useDispatchingMutation,
	useDispatchingQuery,
	useMainPageQueries, WayId,
	zip
} from '@/components/queries';
import type GeoJSON from "geojson";
import {skipToken, useQueryClient} from '@tanstack/react-query'
import * as Svg from "react-native-svg";
import {OnPressEvent} from "@maplibre/maplibre-react-native/src/types/OnPressEvent";

const MAX_FEATURES_QUERY = 3000

const roadStrokesLayerStyle = (wayIds: string[]|null): MapLibreGL.LineLayerStyle => ({
	lineColor: wayIds ? ["case", ["in", ["id"], ["literal", wayIds] ], "purple", "red"] : "red",
	lineOpacity: ["case", ["in", ["geometry-type"], ["literal", "LineString"]], 1, 0]
})

const roadcasingsLayerStyle = (wayIds: string[]|null): MapLibreGL.FillLayerStyle => ({
	fillColor: wayIds ? ["case", ["in", ["id"], ["literal", wayIds] ], "purple", "red"] : "red",
	fillOpacity: ["case", ["in", ["geometry-type"], ["literal", "Polygon"]], 0.98, 0]
})

const pointsOnWayNearClickLayerStyle: MapLibreGL.CircleLayerStyle = ({
	circleColor: "blue",
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

type State = {
	initialSetup: boolean,
	zoom: number
	tappedLocation: GeoJSON.Point|null
	selectedWays: WayId[]
	visibleBounds: {minlat: number, minlon: number, maxlat: number, maxlon: number}|undefined
	sameRoads: Record<WayId, WayId[]>
	queries: {
		queryNodes: QueryState<unknown, GeoJSON.FeatureCollection<GeoJSON.Point, OsmApi.INode> | null>
		queryWays: QueryState<unknown, GeoJSON.FeatureCollection<GeoJSON.Polygon|GeoJSON.LineString, OsmApi.IWay>|null>
		nearbyWays: QueryState<unknown, FoundNearbyWays>
		osmCapabilities: QueryState<unknown, OsmApi.IApiCapabilities>
		osmVersions: QueryState<unknown, OsmApi.IJSONApiVersions>
		osmMap: QueryState<unknown, { $json: string; $requestedBounds: {minlat: number, minlon: number, maxlat: number, maxlon: number}; }>
		unknownBounds: QueryState<unknown, {minlat: number, minlon: number, maxlat: number, maxlon: number}|null>
		sameRoad: QueryState<unknown, Record<WayId, WayId[]>>
		insertBounds: MutationState<unknown, void>
		insertNodes: MutationState<unknown, boolean>
		insertWays: MutationState<unknown, boolean>
		insertRelatedWays: MutationState<unknown, boolean>
		updateCasings: MutationState<unknown, number>
	}
}

const initialState: State = {
	initialSetup: true,
	tappedLocation: null,
	selectedWays: [],
	visibleBounds: undefined,
	zoom: 14,
	sameRoads: {},
	queries: {
		queryNodes: initialQueryState(),
		queryWays: initialQueryState(),
		nearbyWays: initialQueryState(),
		unknownBounds: initialQueryState(),
		osmCapabilities: initialQueryState(),
		osmMap: initialQueryState(),
		osmVersions: initialQueryState(),
		insertBounds: initialMutationState(),
		insertNodes: initialMutationState(),
		insertWays: initialMutationState(),
		insertRelatedWays: initialMutationState(),
		updateCasings: initialMutationState(),
		sameRoad: initialQueryState()
	}
}

type SelectWay = { action: "select ways", ways: WayId[], select: boolean|"toggle" }
type SetInitialSetup = { action: "post initial setup" }
type SetZoom = { action: "set zoom", zoom: number }
type TapLocation = { action: "tap location", tappedLocation: GeoJSON.Point|null }
type SetVisibleBounds = { action: "set visible bounds", visibleBounds: JsonBBox }
type SetQuery<Query extends keyof State['queries']> = {action: "set query", query: Query, queryState: State['queries'][Query] }

type Action = TapLocation
	| SelectWay
	| SetVisibleBounds
	| SetZoom
	| SetInitialSetup
	| {action: "invalidate same roads"}
	| SetQuery<"unknownBounds">
	| SetQuery<"osmCapabilities">
	| SetQuery<"nearbyWays">
	| SetQuery<"osmMap">
	| SetQuery<"queryNodes">
	| SetQuery<"queryWays">
	| SetQuery<"osmVersions">
	| SetQuery<"insertBounds">
	| SetQuery<"insertNodes">
	| SetQuery<"insertWays">
	| SetQuery<"insertRelatedWays">
	| SetQuery<"updateCasings">
	|SetQuery<"sameRoad">

const reducer = (state: State, action: Action): State => {
	switch (action.action) {
		case "invalidate same roads": {
			return {...state, sameRoads: {}}
		}
		case "post initial setup": {
		   return  state.initialSetup ? {...state, initialSetup: false } : state
		}
		case "set zoom": {
			console.log(action)
			return state.zoom === action.zoom ? state : {...state, zoom: action.zoom}
		}
		case "tap location": {
			return {...state, tappedLocation: action.tappedLocation }
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
				case "sameRoad": {
					if (action.queryState.status === "success" && action.queryState.data) {
						const sameRoads = {...state.sameRoads, ...action.queryState.data}
						let unincluded = 0
						for (const sameRoadsKey in sameRoads) {
							if(state.selectedWays.includes(sameRoadsKey) || unincluded++ < 5 || state.queries.queryWays.data?.features.find(f => f.id === sameRoadsKey)) {
							} else {
								delete sameRoads[sameRoadsKey]
							}
						}
						otherChanges.sameRoads = sameRoads
						console.log("same raods", otherChanges)
					}
					break;
				}
				case "queryWays":
					if(state.zoom < 20 && action.queryState.status === "success" && action.queryState.fetchStatus == "idle" && action.queryState.data?.features.length === MAX_FEATURES_QUERY) {
						console.log("because max features", action.queryState.data?.features.length, "zooming", state.zoom+1)
						otherChanges.zoom = Math.floor(state.zoom)+1
					}
					break;
			}
			return {...state, queries: {...state.queries, [action.query]: action.queryState }, ...otherChanges}
		}
	}
}

function buildStatusString(queries: Record<string, MutationState<unknown, unknown>|QueryState<unknown, unknown>>) {
	const buildStatusStr = (m: MutationState<unknown, unknown>|QueryState<unknown, unknown>) => {
		if ("fetchStatus" in m) {
			switch (m.status) {
				case "success":
					switch (m.fetchStatus) {
						case "idle":
							return "S"
						case "paused":
							return "5"
						case "fetching":
							return "s"
						default:
							return "0"
					}
				case "error":
					switch (m.fetchStatus) {
						case "idle":
							return "E"
						case "paused":
							return "3"
						case "fetching":
							return "e"
						default:
							return "1"
					}
				case "pending":
					switch (m.fetchStatus) {
						case "idle":
							return "P"
						case "paused":
							return "B"
						case "fetching":
							return "p"
						default:
							return "1"
					}
			}
		} else {
			switch (m.status) {
				case "idle":
					return "_*"
				case "error":
					return "e*"
				case "pending":
					return "p*"
				case "success" :
					return "S*"
			}
		}
	}

	return Object.entries(queries)
		.sort(([k1, ] , [k2,]) => k1.localeCompare(k2))
		.map(([k, m]) => k[0] + k.split('').filter(k => /[A-Z]/.test(k)).join('') + buildStatusStr(m))
		.join(" ")
}

// noinspection JSUnusedGlobalSymbols default export is automatically included by expo-router
export default function MainPage() {
	/* standard/project effects */
	useAndroidLocationPermission(() => {})
	const queryClient = useQueryClient()
	const queries = useMainPageQueries()
	const [state, xdispatch] = useReducer(reducer, initialState)
	const dispatch = (a: Action) => { console.log("action", a.action, "query" in a && a.query); return xdispatch(a) }
	const refHighwaystopSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const refPointsOnWayNearClickSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const refRoadcasingsSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const refMapView = useRef<MapLibreGL.MapViewRef|null>(null)
	const refTappedLoc = useRef<MapLibreGL.PointAnnotationRef>(null)

	/* simple synonoms */
	const visibleBounds = state.visibleBounds;
	const doublePaddedBounds = visibleBounds && doublePad(visibleBounds)

	const qNearbyWays = state.queries.nearbyWays
	const tappedLocation1 = state.tappedLocation;
	const nearbyWays: string[]|null = tappedLocation1 && qNearbyWays.data && qNearbyWays.data.ways.length && qNearbyWays.data.ways || null
	const nearbyPoints: GeoJSON.Point[]|null = tappedLocation1 && qNearbyWays.data && qNearbyWays.data.nodes.length && qNearbyWays.data.nodes || null
	const pointsOnWayNearClick: GeoJSON.FeatureCollection<GeoJSON.Geometry, {}>|undefined = tappedLocation1 && nearbyPoints && nearbyPoints.length ? {
		type: "FeatureCollection",
		features: nearbyPoints.map(geometry => ({type:"Feature", properties:{}, geometry}))
	} : undefined

	const mapArea = visibleBounds ? (visibleBounds.maxlon - visibleBounds.minlon) * (visibleBounds.maxlat - visibleBounds.minlat) : undefined
	const capability = state.queries.osmCapabilities.data?.api.area.maximum
	const osmMapArgs: JsonBBox|undefined = state.queries.unknownBounds.data || visibleBounds
	const symbols = state.queries.queryNodes.data || null
	const roadcasings = state.queries.queryWays.data || null

	const fab = !!tappedLocation1
	const possiblyAffectedWays: [string, GeoJSON.Point][] = zip(nearbyWays || [], nearbyPoints || [])
	const statusString = buildStatusString(state.queries)

	const radians = undefined //todo implement this somehow.
	const highlightWays = state.selectedWays.concat(state.selectedWays.flatMap(f => state.sameRoads[f] || []))

	const neededRoads = state.selectedWays.filter(f => !(f in state.sameRoads) || !state.sameRoads[f])

	/* queries */
	useDispatchingQuery(
		(queryState: QueryState<unknown, Record<WayId, WayId[]>>) => dispatch({action: "set query", query: "sameRoad", queryState}),
		{
			queryKey: ["spatialite", "ways", "road ways", neededRoads],
			enabled: neededRoads.length > 0,
			queryFn: () => queries.current.doFindSameRoads(neededRoads),
		}
	)
	useDispatchingQuery(
		(queryState: QueryState<unknown, FoundNearbyWays>) => dispatch({action: "set query", query: "nearbyWays", queryState}),
		{
			queryKey: ["spatialite", "nearby ways", tappedLocation1],
			// refetchOnMount: false,
			// refetchOnWindowFocus: false,
			// refetchOnReconnect: false,
			// refetchInterval: 1000*1000*1000,
			enabled: !!tappedLocation1 ,
			queryFn: tappedLocation1 && doublePaddedBounds ? (() => queries.current.doFindNearbyWays({"$lat": tappedLocation1.coordinates[1], "$lon": tappedLocation1.coordinates[0], ...doublePaddedBounds})) : undefined
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
		(queryState: QueryState<unknown, GeoJSON.FeatureCollection<GeoJSON.Polygon|GeoJSON.LineString, OsmApi.IWay>|null>) => dispatch({action: "set query", query: "queryWays", queryState}),
		{
			queryKey: ["spatialite query ways", (doublePaddedBounds || {})],
			enabled: !!doublePaddedBounds,
			placeholderData: (d) => d,
			queryFn: doublePaddedBounds && (async (): Promise<GeoJSON.FeatureCollection<GeoJSON.Polygon|GeoJSON.LineString, OsmApi.IWay>|null> => {
				const ways = await fromAsync(queries.current.doQueryWays({... doublePaddedBounds, $limit: MAX_FEATURES_QUERY}))
				return ways.length ? {type: "FeatureCollection", features: ways } : null
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
	const setTappedLocation = (tappedLocation: GeoJSON.Point|null) => dispatch({ action: "tap location", tappedLocation})
	const onPressMap = (event: GeoJSON.Feature<GeoJSON.Point>) => { console.log("from map", event); setTappedLocation(state.tappedLocation ? null : event.geometry)}
	const onPressWay = (event: OnPressEvent) => { console.log("from way", event); dispatch({action: "select ways", ways: event.features.map(i => i.id!.toString()), select: "toggle"}) }
	const onPressCancelCurrentClick = () => { setTappedLocation(null) }

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
			dispatch({action: "set zoom", zoom: feature.properties.zoomLevel})
		} else {
			console.log("not setting becaues ....", feature.properties.zoomLevel, feature.properties.isUserInteraction, state.initialSetup)
		}
	}

	useEffect(
		() => {
			if (state.initialSetup) {
				setTimeout(() => dispatch({ action: "post initial setup" }), 5_000)
			}
		},
		[]
	)

	return (
		<View
			style={styles.page}
		>
			<Text>{statusString}</Text>
			<MapLibreGL.MapView
				onRegionDidChange={onMapBoundChange}
				ref={refMapView}
				style={styles.map}
				logoEnabled={false}
				styleURL="https://tiles.openfreemap.org/styles/liberty"
				onPress={onPressMap}
			>
				{pointsOnWayNearClick && <MapLibreGL.ShapeSource
					id="pointsOnWayNearClick"
					shape={pointsOnWayNearClick}
					ref={refPointsOnWayNearClickSource}
					onPress={onPressCancelCurrentClick}
				>
					<MapLibreGL.CircleLayer
						id="pointsOnWayNearClicks"
						style={pointsOnWayNearClickLayerStyle}
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
					zoomLevel={state.zoom}
					followUserMode={MapLibreGL.UserTrackingMode.Follow}
					followUserLocation
				/>
				{tappedLocation1 && <MapLibreGL.PointAnnotation key={radians} ref={refTappedLoc} onSelected={() => setTappedLocation(null)} onDragEnd={e => setTappedLocation(e.geometry)} id="centrepoint" coordinate={tappedLocation1.coordinates} draggable={true} >
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
			<FAB
				visible={fab}
				onPress={() => tappedLocation1 && router.navigate("../Add sign?" + prepareSignArgs({traffic_sign: 'stop', point: tappedLocation1}).toString() as any)}
				placement="right"
				title="Add Sign"
				icon={{ name: 'diamond-turn-right', type: 'font-awesome-6', color: 'white' }}
				color="red"
			/>
		</View>
	);
}

const sha256: ((ascii: string) => string|undefined) = function sha256(ascii: string): string {
    function rightRotate(value: number, amount: number) {
        return (value>>>amount) | (value<<(32 - amount));
    };

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