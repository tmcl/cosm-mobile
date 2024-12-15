import fromAsync from 'array-from-async';
import React, {useEffect, useRef, useState} from 'react'
import {FAB} from '@rneui/themed'
import {Pressable, StyleSheet, Text, View} from "react-native";
import {Image} from 'expo-image'
import {Link, router} from "expo-router";
import MapLibreGL from '@maplibre/maplibre-react-native';
import type {RegionPayload} from '@maplibre/maplibre-react-native/src/components/MapView';
import * as SQLite from 'expo-sqlite'
import * as OsmApi from "@/scripts/clients";
import {useDrizzleStudio} from "expo-drizzle-studio-plugin"
import {useAndroidLocationPermission} from '@/components/AndroidLocationPermission';
import {OnPressEvent} from '@maplibre/maplibre-react-native/src/types/OnPressEvent';
import {prepareSignArgs} from '../Add sign';
import {MainPageQueries as Queries, zip} from '@/components/queries';
import type GeoJSON from "geojson";
import * as ReactQuery from '@tanstack/react-query'

const consoleLog: typeof console.log = () => {}

const doublePad = ([minlon, minlat, maxlon, maxlat]: GeoJSON.BBox): [number, number, number, number] => {
	const $minlon = minlon - (maxlon - minlon)
	const $maxlon = maxlon + (maxlon - minlon)
	const $minlat = minlat - (maxlat - minlat)
	const $maxlat = maxlat + (maxlat - minlat)
	return [$minlon, $minlat, $maxlon, $maxlat]
}

const roadStrokesLayerStyle = (wayIds: string[]|null): MapLibreGL.LineLayerStyle => ({
	lineColor: wayIds ? ["case", ["in", ["id"], ["literal", wayIds] ], "purple", "red"] : "red",
	lineOpacity: ["case", ["in", ["geometry-type"], ["literal", "LineString"]], 1, 0]
})

const roadcasingsLayerStyle = (wayIds: string[]|null): MapLibreGL.FillLayerStyle => ({
	fillColor: wayIds ? ["case", ["in", ["id"], ["literal", wayIds] ], "purple", "red"] : "red",
	fillOpacity: ["case", ["in", ["geometry-type"], ["literal", "Polygon"]], 0.48, 0]
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

// noinspection JSUnusedGlobalSymbols default export is automatically included by expo-router
export default function MainPage() {
	const db = SQLite.useSQLiteContext()
	const queries = useRef(new Queries())
	const queryClient = ReactQuery.useQueryClient()
	useDrizzleStudio(db)
	useEffect(() => {
		queries.current.setup(db)
		return () => queries.current.finalize()
	}, [db])

	const [currentClick, setCurrentClick] = useState<GeoJSON.Point|null>(null)
	const queryStatuses: Record<string, {query: ReactQuery.QueryStatus, fetch: ReactQuery.FetchStatus} | {mutate: ReactQuery.MutationStatus}> = {}

	const onPress = (event: GeoJSON.Feature<GeoJSON.Point>) => {
		const { geometry } = event;
		setCurrentClick(geometry)
		setImageTags(null)
	}

	const [mapArea, setMapArea] = useState<[number, number] | "unknown" | "unloaded">("unknown")

	const [visibleBounds, setVisibleBounds] = useState<GeoJSON.BBox>([0, 0, 0, 0])

	const qNearbyWays = ReactQuery.useQuery({
		queryKey: ["spatialite", "nearby ways", ...(currentClick ? Object.values(currentClick) : [])],
		enabled: !!currentClick,
		queryFn: currentClick ? (() => queries.current.doFindNearbyWays({"$lat": currentClick.coordinates[1], "$lon": currentClick.coordinates[0], ...doublePaddedBounds})) : undefined
	})
	queryStatuses.qNearbyWays = {query: qNearbyWays.status, fetch: qNearbyWays.fetchStatus}
	const nearbyWays: string[]|null = currentClick && qNearbyWays.data && qNearbyWays.data.ways.length && qNearbyWays.data.ways || null
	const nearbyPoints: GeoJSON.Point[]|null = currentClick && qNearbyWays.data && qNearbyWays.data.nodes.length && qNearbyWays.data.nodes || null
	const pointsOnWayNearClick: GeoJSON.FeatureCollection<GeoJSON.Geometry, {}>|undefined = currentClick && nearbyPoints && nearbyPoints.length ? {
		type: "FeatureCollection",
		features: nearbyPoints.map(geometry => ({type:"Feature", properties:{}, geometry}))
	} : undefined

	const [$minlon, $minlat, $maxlon, $maxlat] = visibleBounds
	const qUnkownBoundsEnabled = (() => {
		if (typeof mapArea === "string") return false
		const [deg, capability] = mapArea
		return (deg * 10 <= capability) && !!($minlon || $minlat || $maxlon || $maxlat)
	})()
	const qUnknownBounds = (() => {
		return ReactQuery.useQuery({
			queryKey: ["spatialite known bounds", $minlon, $minlat, $maxlon, $maxlat],
			enabled: qUnkownBoundsEnabled,
			queryFn: () => queries.current.doKnownBounds({$minlon, $minlat, $maxlon, $maxlat})
		})
	})()
	queryStatuses.qUnknownBounds = { query: qUnknownBounds.status, fetch: qUnknownBounds.fetchStatus }

	const qOsmMap = (() => {
		const [minlon, minlat, maxlon, maxlat] = qUnknownBounds.data ? qUnknownBounds.data.bbox! : [$minlon, $minlat, $maxlon, $maxlat]
		return ReactQuery.useQuery<{ $json: string; $requestedBounds: [number, number, number, number]; }>({
			queryKey: ["osm map", minlon, minlat, maxlon, maxlat],
			enabled: qUnknownBounds.isSuccess && !!qUnknownBounds.data?.coordinates.length ,
			queryFn: async () => ({$json: await OsmApi.getApi06MapText({minlon, minlat, maxlon, maxlat}), $requestedBounds: [minlon, minlat, maxlon, maxlat]})
		})
	})()
	queryStatuses.qOsmMap = { query: qOsmMap.status, fetch: qOsmMap.fetchStatus }

	const qInsertBounds = ReactQuery.useMutation({
		mutationFn: (args: {$json: string, $requestedBounds: [number, number, number, number]}) => queries.current.doInsertBounds(args),
		onSuccess: (data, variables, ) => {
			queryClient.invalidateQueries({queryKey: ["spatialite known bounds", ...variables.$requestedBounds]})
		}
	})
	queryStatuses.qInsertBounds = { mutate: qInsertBounds.status }

	const qInsertNodes = ReactQuery.useMutation({
		mutationFn: (param: { $json: string }) => queries.current.doInsertNodes(param),
		onSuccess: (data ) => {
			if(data.changes) {
				queryClient.invalidateQueries({queryKey: ["spatialite query nodes"]})
			}
		}
	})
	queryStatuses.qInsertNodes = { mutate: qInsertNodes.status }

	const qInsertWays = ReactQuery.useMutation({
		mutationFn: (param: { $json: string }) => queries.current.doInsertWays(param),
		onSuccess: (data) => {
			if(data.filter(d => d.changes).length) {
				queryClient.invalidateQueries({queryKey: ["spatialite query ways"]})
				queryClient.invalidateQueries({queryKey: ["spatialite", "nearby ways"]})
				qUpdateCasings.mutate()
			}
		}
	})
	queryStatuses.qInsertWays = { mutate: qInsertWays.status }

	const qUpdateCasings = ReactQuery.useMutation({
		mutationFn: () => queries.current.doAddCasingToWays(),
		onSuccess: (data) => {
			if(data.changes) {
				queryClient.invalidateQueries({queryKey: ["spatialite query ways"]})
				queryClient.invalidateQueries({queryKey: ["spatialite", "nearby ways"]})
				setTimeout(() => qUpdateCasings.mutate(), 1)
			}
		}
	})
	queryStatuses.qUpdateCasings = { mutate: qUpdateCasings.status }


	useEffect(() => {
		if(!qOsmMap.isSuccess) return
		qInsertBounds.mutate(qOsmMap.data)
		qInsertNodes.mutate(qOsmMap.data)
		qInsertWays.mutate(qOsmMap.data)
	}, [qOsmMap.isSuccess, qOsmMap.data?.$json])

	const doublePaddedBounds = (() => {
		const [$minlon, $minlat, $maxlon, $maxlat] = doublePad(visibleBounds)
		return {$minlon, $minlat, $maxlon, $maxlat}
	})()

	const qGetSignNodes = ReactQuery.useQuery({
		queryKey: ["spatialite query nodes", ...Object.values(doublePaddedBounds)],
		enabled: !!(doublePaddedBounds.$minlon || doublePaddedBounds.$minlat || doublePaddedBounds.$maxlon || doublePaddedBounds.$maxlat),
		queryFn: async ():Promise<GeoJSON.FeatureCollection<GeoJSON.Point, OsmApi.INode> | null> => {
			const nodes = await fromAsync(queries.current.doQueryNodes(doublePaddedBounds))
			return nodes.length ? {type: "FeatureCollection", features: nodes} : null
		}
	})
	queryStatuses.qGetSignNodes = { query: qGetSignNodes.status, fetch: qGetSignNodes.fetchStatus }

	const qGetSignWays = ReactQuery.useQuery({
		queryKey: ["spatialite query ways", ...Object.values(doublePaddedBounds)],
		enabled: !!(doublePaddedBounds.$minlon || doublePaddedBounds.$minlat || doublePaddedBounds.$maxlon || doublePaddedBounds.$maxlat),
		queryFn: async (): Promise<GeoJSON.FeatureCollection<GeoJSON.Polygon|GeoJSON.LineString, OsmApi.IWay>|null> => {
			const ways = await fromAsync(queries.current.doQueryWays(doublePaddedBounds))
			return ways.length ? {type: "FeatureCollection", features: ways } : null
		}
	})
	queryStatuses.qGetSignWays = { query: qGetSignWays.status, fetch: qGetSignWays.fetchStatus }

	const symbols = qGetSignNodes.data || null
	const roadcasings = qGetSignWays.data || null

	const mapView = useRef<{ o: MapLibreGL.MapViewRef | null }>({ o: null })

	const qVersionList = ReactQuery.useQuery({ queryKey: ['osm query version'], queryFn: OsmApi.getApiVersions, staleTime: 7*24*60*60*1000 })
	const qCapabalitiesList = ReactQuery.useQuery({
		queryKey: ['osm query capabilities', qVersionList.data],
		enabled: qVersionList.isSuccess && qVersionList.data.api.versions.includes("0.6"),
		queryFn: OsmApi.getApi06Capabilities,
		staleTime: 7*24*60*60*1000
	})

	const onMapBoundChange = (feature: GeoJSON.Feature<GeoJSON.Point, RegionPayload>) => {
		const c = qCapabalitiesList.isSuccess && qCapabalitiesList.data.api.area.maximum
		if (!c) return;
		consoleLog('observed map bounds change')
		const [ne, sw] = feature.properties.visibleBounds
		const $maxlon = ne[0]
		const $maxlat = ne[1]
		const $minlon = sw[0]
		const $minlat = sw[1]
		let needsUpdate = true
		if(visibleBounds) {
			const [minlon, minlat, maxlon, maxlat] = visibleBounds
			needsUpdate = !(minlon == $minlon && minlat == $minlat && maxlon == $maxlon && maxlat == $maxlat)
		}

		if (needsUpdate) setVisibleBounds([$minlon, $minlat, $maxlon, $maxlat])
		const ew = ne[0] - sw[0]
		const ns = ne[1] - sw[1]
		const deg = ns * ew
		if (typeof mapArea != "string" && mapArea[0] == deg)
			return;
		setMapArea([deg, c])
	}


	const onPressCancelCurrentClick = () => { setCurrentClick(null) }
	const highwaystopSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const pointsOnWayNearClickSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const roadcasingsSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const [, setAndroidPermissionGranted] = useState<boolean | null>(null);
	useAndroidLocationPermission(setAndroidPermissionGranted)
	const [imageTags, setImageTags] = useState<{nsiId: number, nsiLatLon: [number, number], nsiBasicTags: {[ix: string]: string}}|null>(null)

	const fab = !!nearbyWays?.length || !!nearbyPoints?.length
	const onPressFeature = (e: OnPressEvent) => {
		setImageTags({nsiId: e.features[0].properties?.id, nsiLatLon: [e.coordinates.latitude, e.coordinates.longitude], nsiBasicTags: e.features[0].properties?.tags})
	}
	const imgUrl = imageTags && "https://trafficsigns.tmcl.dev/sign/from-json.png?" + new URLSearchParams({tags: JSON.stringify(imageTags)}).toString()
	const [imgbody, setimgbody] = useState<string|null>(null)
	useEffect( () => {
		(async () => { 
			if (!imgUrl) { setimgbody(null); return }
			const result = await fetch(imgUrl, {headers: {Accept: "image/png"}})
			if (!result.ok) return
			const body = new Blob([await result.blob()], {type: "image/png"})
			imgbody && URL.revokeObjectURL(imgbody)
			const bodytxt = URL.createObjectURL(body)
			setimgbody(bodytxt)
		})()
	}, [imgUrl])
	const possiblyAffectedWays: [string, GeoJSON.Point][] = zip(nearbyWays || [], nearbyPoints || [])
	const buildStatusStr = (m: typeof queryStatuses[keyof typeof queryStatuses]) => {
			if ("mutate" in m) {
				switch (m.mutate) {
					case "idle": return "_"
					case "error": return "E"
					case "pending": return "P"
					case "success" : return "S"
				}
			} else {
				switch (m.query) {
					case "success":
						switch (m.fetch) {
							case "idle": return "S"
							case "paused": return "5"
							case "fetching": return "s"
							default: return "0"
						}
					case "error":
						switch (m.fetch) {
							case "idle": return "E"
							case "paused": return "3"
							case "fetching": return "e"
							default: return "1"
						}
					case "pending":
						switch (m.fetch) {
							case "idle": return "P"
							case "paused": return "B"
							case "fetching": return "p"
							default: return "1"
						}
				}
			}
		}
	const statusString = Object.entries(queryStatuses)
		.map(([k, m]) => k.split('').filter(k => /[A-Z]/.test(k)).join('') + buildStatusStr(m))
		.join(" ")
	return (
		<View
			style={styles.page}
		>
			{imgbody && <Image contentFit='contain' style={{position: "absolute", zIndex: 1, top: 10, left: 150, width: 100, height: 100}} source={{uri: imgbody, width:100 , height:100 }} /> }
			{imgUrl && <Link href={imgUrl as any} asChild><Pressable><Text>View details</Text></Pressable></Link> }
			<Text>{statusString}</Text>
			<MapLibreGL.MapView
				onRegionDidChange={onMapBoundChange}
				ref={(r) => { mapView.current.o = r }}
				style={styles.map}
				logoEnabled={false}
				styleURL="https://tiles.openfreemap.org/styles/liberty"
				onPress={onPress}
			>
				{pointsOnWayNearClick && <MapLibreGL.ShapeSource
					id="pointsOnWayNearClick"
					shape={pointsOnWayNearClick}
					ref={pointsOnWayNearClickSource}
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
					ref={highwaystopSource}
					onPress={onPressFeature}
				>
					<MapLibreGL.CircleLayer
						id="points"
						style={circleLayerStyle(imageTags ? imageTags.nsiId : undefined)}
					/>

				</MapLibreGL.ShapeSource>}
				{roadcasings && <MapLibreGL.ShapeSource
					id="roadcasing"
					shape={roadcasings}
					ref={roadcasingsSource}
				>
					<MapLibreGL.FillLayer
						id="roadcasingfill"
						style={roadcasingsLayerStyle(nearbyWays)}
					/>
					<MapLibreGL.LineLayer
						id="roadstrokeslines"
						style={roadStrokesLayerStyle(nearbyWays)}
					/>

				</MapLibreGL.ShapeSource>}
				<MapLibreGL.Camera
					zoomLevel={16}
					followUserMode={MapLibreGL.UserTrackingMode.Follow}
					followUserLocation
				/>

			</MapLibreGL.MapView>
			<FAB
				visible={fab && !!currentClick}
				onPress={() => currentClick && router.navigate("../Add sign?" + prepareSignArgs({traffic_sign: 'hazard hazard=?!', possibly_affected_ways: possiblyAffectedWays, point: currentClick}).toString() as any)}
				placement="right"
				title="Add Sign"
				icon={{ name: 'diamond-turn-right', type: 'font-awesome-6', color: 'white' }}
				color="red"
			/>
		</View>
	);
}
