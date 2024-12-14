import fromAsync from 'array-from-async';
import React, {MutableRefObject, useEffect, useRef, useState} from 'react'
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
import {debug, MemoryWorkerQueue, MainPageQueries as Queries, zip} from '@/components/queries';
import type GeoJSON from "geojson";

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
	fillColor: debug("wayIds", wayIds) ? ["case", ["in", ["id"], ["literal", wayIds] ], "purple", "red"] : "red",
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

type UpdateRoadCasingsProps = {
	queries: MutableRefObject<Queries>
	taskManager: MutableRefObject<MemoryWorkerQueue>
	onNewCasings: () => void
}
const updateRoadCasings = (props: UpdateRoadCasingsProps, depth: number) => {
	setTimeout(async () => {
		consoleLog("updated road casings, begin", depth)
		try {
			const r = await props.queries.current.doAddCasingToWays()
			consoleLog("updated road casings, found", r.changes, depth)
			if (r.changes > 0) {
				props.onNewCasings()
				updateRoadCasings(props, depth + 1)
			}
		} catch (e) {
			consoleLog("updated road casings, failed", e, depth)
		}
	}, 10)
}

// noinspection JSUnusedGlobalSymbols default export is automatically included by expo-router
export default function MainPage() {
	const db = SQLite.useSQLiteContext()
	const queries = useRef(new Queries())
	const taskManager = useRef(new MemoryWorkerQueue())
	useDrizzleStudio(db)
	useEffect(() => {
		queries.current.setup(db)
		return () => queries.current.finalize()
	}, [db])

	const [currentClick, setCurrentClick] = useState<GeoJSON.Point|null>(null)

	const onPress = (event: GeoJSON.Feature<GeoJSON.Point>) => {
		const { geometry, properties } = event;
		setCurrentClick(geometry)
		setImageTags(null)
	}

	const [versionList, setVersionList] = useState<(OsmApi.OsmStandard & OsmApi.JSONApiVersions) | null>(null);
	const [capabilitiesList, setCapabilitiesList] = useState<(OsmApi.ApiCapabilities) | null>(null);
	const [mapArea, setMapArea] = useState<[number, number] | "unknown" | "unloaded">("unknown")

	const [symbols, setSymbols] = useState<GeoJSON.FeatureCollection<GeoJSON.Point, OsmApi.INode> | null>(null)
	const [roadcasings, setRoadcasingsx] = useState<GeoJSON.FeatureCollection<GeoJSON.Polygon|GeoJSON.LineString, OsmApi.IWay> | null>(null)
	const setRoadcasings = (roadCasings: typeof roadcasings)  => {
		if(!roadCasings) return
		const r: Record<string|number, number> = {}
		roadCasings.features.forEach(f => f.id && (r[f.id] = (r[f.id] || 0)+1 ))
		consoleLog(Object.entries(r).filter(([id, num]) => num > 1), "updated roadcasings")
		setRoadcasingsx(roadCasings)
	}

	const [visibleBounds, setVisibleBounds] = useState<GeoJSON.BBox | null>(null)

	const [nearbyWays, setNearbyWays] = useState<string[]|null>(null)
	const [nearbyPoints, setNearbyPoints] = useState<GeoJSON.Point[]|null>(null)

	const pointsOnWayNearClick: GeoJSON.FeatureCollection<GeoJSON.Geometry, {}>|undefined = currentClick && nearbyPoints && nearbyPoints.length ? {
		type: "FeatureCollection",
		features: nearbyPoints.map(geometry => ({type:"Feature", properties:{}, geometry}))
	} : undefined

	const [newData, setNewData] = useState({})

	useEffect(() => {
		const [deg, c] = typeof mapArea === "string" ? [0, 0] : mapArea

		if (!visibleBounds) return
		if (deg * 10 > c) return

		const [$minlon, $minlat, $maxlon, $maxlat] = visibleBounds

		;(async () => {
				const bounds = await queries.current.doKnownBounds({ $minlon, $minlat, $maxlon, $maxlat })

				if (bounds && bounds?.coordinates.length !== 0) {
					const [minlon, minlat, maxlon, maxlat] = bounds ? bounds.bbox! : [$minlon, $minlat, $maxlon, $maxlat]
					const $json = await OsmApi.getApi06MapText({ minlon, minlat, maxlon, maxlat })
					await queries.current.doInsertBounds({ $json, $requestedBounds: [minlon, minlat, maxlon, maxlat] })
					await queries.current.doInsertNodes({ $json })
					const {waysInserted, nodeWaysInserted} = queries.current.doInsertWays({ $json })
					await waysInserted
					await nodeWaysInserted
					setNewData({})
					updateRoadCasings({queries, taskManager, onNewCasings: () => setNewData({})}, 0)
				} else {
					consoleLog('no insert')
				}
			})()
		}, [visibleBounds])

	useEffect(() => {
			(async() => {
				if(!visibleBounds) return

				const [$minlon, $minlat, $maxlon, $maxlat] = doublePad(visibleBounds)

				const symbols: GeoJSON.Feature<GeoJSON.Point, OsmApi.INode>[] | undefined
					= await fromAsync(queries.current.doQueryNodes({$minlon, $minlat, $maxlon, $maxlat}))

				const roadCasings: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, OsmApi.IWay>[]
					= await fromAsync(queries.current.doQueryWays({$minlon, $minlat, $maxlon, $maxlat}))

				setSymbols(symbols ? { type: "FeatureCollection", features: symbols } : null)
				setRoadcasings(roadCasings ? { type: "FeatureCollection", features: roadCasings } : null)
			})()
	}, [visibleBounds, newData])

	const onMapBoundChange = (feature: GeoJSON.Feature<GeoJSON.Point, RegionPayload>) => {
		const c = capabilitiesList && capabilitiesList.api.area.maximum
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

	const mapView = useRef<{ o: MapLibreGL.MapViewRef | null }>({ o: null })

	useEffect(() => {
		(async () => {
			const r = await OsmApi.getApiVersions();
			setVersionList(r)
		})()
	}, [])

	useEffect(() => {
		(async () => {
			const knownVersion: "0.6" = "0.6"
			if (versionList && versionList.api.versions.includes(knownVersion)) {
				const r = await OsmApi.getApi06Capabilities()
				setCapabilitiesList(r)
			}
		})()
	}, [versionList])

	const onPressCancelCurrentClick = () => { setCurrentClick(null) }
	const highwaystopSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const pointsOnWayNearClickSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const roadcasingsSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const [isAndroidPermissionGranted, setAndroidPermissionGrantedx] = useState<boolean | null>(null);
	const setAndroidPermissionGranted = (apg: typeof isAndroidPermissionGranted) => setAndroidPermissionGrantedx(debug("a p g", apg))
	useAndroidLocationPermission(setAndroidPermissionGranted)
	const [imageTags, setImageTagsx] = useState<{nsiId: number, nsiLatLon: [number, number], nsiBasicTags: {[ix: string]: string}}|null>(null)
	useEffect(() => {
		(async () => {
			if(!currentClick) { setNearbyWays(null); return }

			const ways = await queries.current.doFindNearbyWays({"$lat": currentClick.coordinates[1], "$lon": currentClick.coordinates[0]})
			console.log("these are the nearby ways", ways)
			const wayIds = ways.map(w => w.id)
			const nearestPoint = ways.map(w => JSON.parse(w.nearest)) as GeoJSON.Point[]
			setNearbyWays(!!wayIds?.length ? wayIds : null)
			setNearbyPoints(!!nearestPoint?.length ? nearestPoint : null)
		})()

	}, [currentClick])
	const fab = !!nearbyWays?.length || !!nearbyPoints?.length
	const setImageTags = (it: typeof imageTags) => setImageTagsx(debug("image tags", it))
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
	return (
		<View
			style={styles.page}
		>
			{imgbody && <Image contentFit='contain' style={{position: "absolute", zIndex: 1, top: 10, left: 150, width: 100, height: 100}} source={{uri: imgbody, width:100 , height:100 }} /> }
			{imgUrl && <Link href={imgUrl as any} asChild><Pressable><Text>View details</Text></Pressable></Link> }
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
						style={circleLayerStyle(imageTags ? debug("number", imageTags.nsiId) : undefined)}
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
