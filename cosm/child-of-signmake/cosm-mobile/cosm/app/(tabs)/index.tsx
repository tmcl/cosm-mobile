import React, { useState, useEffect, useRef } from 'react'
import {FAB} from '@rneui/themed'
import Foundation from '@expo/vector-icons/Foundation';
import { Text, View, Pressable, StyleSheet, Image as RnImage } from "react-native";
import { Image } from 'expo-image'
import { Link, router } from "expo-router";
import MapLibreGL from '@maplibre/maplibre-react-native';
import type { RegionPayload } from '@maplibre/maplibre-react-native/src/components/MapView';
import * as SQLite from 'expo-sqlite'
import * as OsmApi from "@/scripts/clients";
import { useDrizzleStudio } from "expo-drizzle-studio-plugin"
import { useAndroidLocationPermission } from '@/components/AndroidLocationPermission';
import { OnPressEvent } from '@maplibre/maplibre-react-native/src/types/OnPressEvent';
import { Asset } from 'expo-asset';
import { prepareSignArgs } from '../Add sign';
import { MainPageQueries as Queries, debug, JustOnce, zip } from '@/components/queries';

const roadcasingsLayerStyle = (wayIds: string[]|null): MapLibreGL.FillLayerStyle => ({
	fillColor: wayIds ? ["case", ["in", ["id"], ["literal", wayIds] ], "yellow", "purple"] : "red",
	fillOpacity: 0.48,
})

const currentClickLayerStyle: MapLibreGL.CircleLayerStyle = ({
	circleColor: "blue",
	circleOpacity: 1,
	circleStrokeWidth: 2,
	circleStrokeColor: "white",
	circleRadius: 5,
	circlePitchAlignment: "map"
})

const circleLayerStyle = (input: number|undefined): MapLibreGL.CircleLayerStyle => ({
	//circleColor: ["match", ["to-number", ["get", "uid"]], 21657989, "yellow", "purple"],
	//circleColor: ["case", ["==", ["to-string", ["get", "id"]], "11982813810"], "yellow", "purple"],
	circleColor: input ? ["case", ["==", ["id"], input.toString() ], "yellow", "purple"] : "green",
	//circleColor: ["rgb", ["*", ["%", ["get", "id"], 10], 25], 255, 255],
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

type Click = {
	latitude: number | null
	longitude: number | null
	screenPointX: number
	screenPointY: number
}

type UserLocation = MapLibreGL.Location

const defaultLocation: UserLocation = {
	timestamp: 0,
	coords: {
		latitude: 0.0,
		longitude: 0.0,
		altitude: 0.0,
		heading: 0.0,
		accuracy: 0.0,
		speed: 0.0,
	}
}

export default function Sottings() {
	const db = SQLite.useSQLiteContext()
	const queries = useRef(new Queries())
	useDrizzleStudio(db)

	const [currentClick1, setCurrentClick1] = useState<GeoJSON.Point|null>(null)

	const [fab, setFab] = useState<boolean>(false)
	const onPress = (event: GeoJSON.Feature<GeoJSON.Point>) => {
		const { geometry, properties } = event;
		setCurrentClick1(geometry)
		setImageTags(null)
		console.log('press space', geometry, properties)
	}

	const [userLocation, setUserLocationx] = useState(defaultLocation);
	const setUserLocation = (f: typeof userLocation) => {
		if (userLocation.coords.accuracy === f.coords.accuracy) {
			return;
		}
		//return setUserLocationx(debug('user location', {...f, timestamp: undefined}))
	}

	const [versionList, setVersionListx] = useState<(OsmApi.OsmStandard & OsmApi.JSONApiVersions) | null>(null);
	const setVersionList = (vl: typeof versionList) => setVersionListx(debug("version list", vl))

	const [capabilitiesList, setCapabilitiesListx] = useState<(OsmApi.ApiCapabilities) | null>(null);
	const setCapabilitiesList = (cl: typeof capabilitiesList) => setCapabilitiesListx(debug("capabilities list", cl))

	const [mapArea, setMapAreax] = useState<[number, number] | "unknown" | "unloaded">("unknown")
	const setMapArea = (ma: typeof mapArea) => setMapAreax(debug("map area", ma))

	const [symbols, setSymbolsx] = useState<GeoJSON.FeatureCollection<GeoJSON.Point, OsmApi.INode> | null>(null)
	const setSymbols = (s: typeof symbols) => setSymbolsx(debug("symbol", s))
	const [currentClick, setCurrentClickx] = useState<GeoJSON.FeatureCollection<GeoJSON.Point, {}> | null>(null)
	const setCurrentClick = (cc: typeof currentClick) => setCurrentClickx(debug("current click", cc))
	const [roadcasings, setRoadcasingsx] = useState<GeoJSON.FeatureCollection<GeoJSON.Polygon, OsmApi.IWay> | null>(null)
	const setRoadcasings = (rc: typeof roadcasings) => setRoadcasingsx(debug("road casings", rc))

	const [visibleBounds, setVisibleBoundsx] = useState<GeoJSON.BBox | null>(null)
	const setVisibleBounds = (vb: typeof visibleBounds) => setVisibleBoundsx(debug("visible bounds", vb))

	const [nearbyWays, setNearbyWays] = useState<string[]|null>(null)
	const [nearbyPoints, setNearbyPoints] = useState<GeoJSON.Point[]|null>(null)

	useEffect( () => {
		if(!currentClick1) return

		const features: GeoJSON.Feature<GeoJSON.Point, {}>[] = [{ type: "Feature", properties: {}, geometry: currentClick1 }]
		
		if(nearbyPoints?.length) {
			nearbyPoints.forEach(geometry => features.push({type:"Feature", properties:{}, geometry}))
		}

		setCurrentClick({ type: "FeatureCollection", features })
	}, [currentClick1, nearbyPoints])



	useEffect(() => {
		symbols && symbols.features.forEach(f => console.log("mainvestigating", f.properties.uid, typeof f.properties.uid))
		}, [symbols])

	useEffect(() => {
		queries.current.setup(db)

		return () => {
			console.log('finalising')
			queries.current.finalize()
		}
	}, [db])

	const justOnce = useRef(new JustOnce())
	const [newData, setNewData] = useState(0)

	useEffect(() => {
		const [deg, c] = typeof mapArea === "string" ? [0, 0] : mapArea

		if (!visibleBounds) return
		if (deg * 10 > c) return

		const [$minlon, $minlat, $maxlon, $maxlat] = visibleBounds

		justOnce.current.take(async () => {
				console.log('begin initiate queries', 1)
				console.log('begin determine area', 2)


				const boundsStr = await (await queries.current.doKnownBounds({ $minlon, $minlat, $maxlon, $maxlat }))
					?.getFirstAsync() as { difference: string }
				const bounds = JSON.parse(boundsStr.difference) as GeoJSON.Polygon

				console.log('are determined', boundsStr, bounds)

				if (bounds && bounds?.coordinates.length !== 0) {
					const [minlon, minlat, maxlon, maxlat] = bounds ? bounds.bbox! : [$minlon, $minlat, $maxlon, $maxlat]
					console.log('begin api/0.6/map')
					const b = await OsmApi.getApi06MapText({ minlon, minlat, maxlon, maxlat })
					console.log('complete api/0.6/map', b)
					console.log('insert initiated')
					await queries.current.doInsertBounds({ '$json': b })
					console.log('insert bounds a great success')
					await queries.current.doInsertNodes({ '$json': b})
					console.log('insert nodes a great success')
					const {waysInserted, nodeWaysInserted} = queries.current.doInsertWays({ $json: b })
					await waysInserted
					console.log('insert ways part1 a great success')
					await nodeWaysInserted
					console.log('insert complete')
					setNewData(newData+1)
				} else {
					console.log('no insert')
				}
			})
		}, [visibleBounds])

	useEffect(() => {
			(async() => {
				if(!visibleBounds) return

				const [minlon, minlat, maxlon, maxlat] = visibleBounds
				const $minlon  = minlon - (maxlon - minlon)
				const $maxlon  = maxlon + (maxlon - minlon)
				const $minlat  = minlat - (maxlat - minlat)
				const $maxlat  = maxlat + (maxlat - minlat)
				console.log('highway stop/cqueries initiated')
				const doHighwayStop = async () => {
					try {
					  return ((await (await queries.current.doQueryNodes())?.getAllAsync()) as { geojson: string }[])
						?.map(geo => { 
							const r: GeoJSON.Feature<GeoJSON.Point, OsmApi.INode> = JSON.parse(geo.geojson) 
							r.id = r.properties.id.toString()
							return r
						})
					} catch (e) {
						console.log("doing highway stop, we got an error", e)
						throw e
					}
				}

				console.log("do hwy stop")

				const highwayStop: GeoJSON.Feature<GeoJSON.Point, OsmApi.INode>[] | undefined
					= await doHighwayStop()

				console.log("did hwy stop", highwayStop.length)

				const doRoadCasings = async () => {
					try {
						return ((await (await queries.current.doQueryWays({$minlon, $minlat, $maxlon, $maxlat}))?.getAllAsync()) as { geojson: string }[])
						?.map(geo => { 
							const r: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay> = JSON.parse(geo.geojson) 
							r.id = r.properties.id.toString()
							return r
						})
					} catch (e) {
						console.log("doing road casingfs , we got an error", e)
						throw e
					}
				}
				const roadCasings: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay>[] | undefined
					= await doRoadCasings()
				console.log('query and parse complete', roadCasings.length)
				setSymbols(highwayStop ? { type: "FeatureCollection", features: highwayStop } : null)
				setRoadcasings(roadCasings ? { type: "FeatureCollection", features: roadCasings } : null)
				let i = 0;
				if (highwayStop == null) return
				for (const r of highwayStop) {
					console.log(r, 'results', i, r.type, r.geometry, r.properties)
					if (i++ > 10) break;
				}
				console.log('done all')
				// queryNodes = await spatialite?.db.prepareAsync(`
				// 	select * from nodes where 
				// 	`)
				// setSymbols({type: "FeatureCollection", features: filtered})
				// console.log({type: "FeatureCollection", features: filtered})

			})()
	}, [visibleBounds, newData])

	const onMapBoundChange = (feature: GeoJSON.Feature<GeoJSON.Point, RegionPayload>) => {
		const c = capabilitiesList && capabilitiesList.api.area.maximum
		if (!c) return;
		console.log('observed map bounds change')
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
		if (deg * 10 < c) {
		}
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

	const onPressCancelCurrentClick = () => { setCurrentClick1(null) }
	const highwaystopSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const currentClickSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const roadcasingsSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const [isAndroidPermissionGranted, setAndroidPermissionGrantedx] = useState<boolean | null>(null);
	const setAndroidPermissionGranted = (apg: typeof isAndroidPermissionGranted) => setAndroidPermissionGrantedx(debug("a p g", apg))
	useAndroidLocationPermission(setAndroidPermissionGranted)
	const [imageTags, setImageTagsx] = useState<{nsiId: number, nsiLatLon: [number, number], nsiBasicTags: {[ix: string]: string}}|null>(null)
	useEffect(() => {
		(async () => {
			if(!currentClick1) { setNearbyWays(null); return }

			const ways1 = await queries.current.doFindNearbyWays({"$lat": currentClick1.coordinates[1], "$lon": currentClick1.coordinates[0]})
			console.log("doing ways1")
			const ways2 = (await ways1?.getAllAsync() as {dist: number, id: number, nearest: string}[] | undefined) 
			console.log("doing ways2", ways2, typeof ways2)
			const r = ways2?.map(w => w.id.toString()) 
			const p = ways2?.map(w => JSON.parse(w.nearest)) as GeoJSON.Point[]
			console.log("doing ways3", r, r?.toString(), r?.constructor.toString(), !!r)
			setNearbyWays(!!r?.length ? r : null)
			setNearbyPoints(!!p?.length ? p : null)
			console.log("set nearby ways")
			console.log("some ways", ways2)
		})()

	}, [currentClick1])
	useEffect(() => {
		const fabvis=!!nearbyWays?.length || !!nearbyPoints?.length
		console.log("i am interested in setting the fab visibility", nearbyWays, nearbyWays?.length, nearbyPoints, nearbyPoints?.length, fabvis)
		setFab(fabvis)
	}, [nearbyWays, nearbyPoints])
	const setImageTags = (it: typeof imageTags) => setImageTagsx(debug("image tags", it))
	const onPressFeature = (e: OnPressEvent) => {
		console.log('pressed', e.coordinates, e.point, e.features, e.features[0].properties?.tags)
		setImageTags({nsiId: e.features[0].properties?.id, nsiLatLon: [e.coordinates.latitude, e.coordinates.longitude], nsiBasicTags: e.features[0].properties?.tags})
	}
	const imgUrl = imageTags && "https://trafficsigns.tmcl.dev/sign/from-json.png?" + new URLSearchParams({tags: JSON.stringify(imageTags)}).toString()
	console.log('imgurl', imgUrl, imageTags)
	const [imgbody, setimgbody] = useState<string|null>(null)
	useEffect( () => {
		(async () => { 
			if (!imgUrl) { setimgbody(null); return }
			const result = await fetch(imgUrl, {headers: {Accept: "image/png"}})
			console.log(result.ok, result.status, result.statusText)
			if (!result.ok) return
			//if (result.
			const body = new Blob([await result.blob()], {type: "image/png"})
			console.log("type", body.type, result.type, body.size)
			// console.log(body)
			//if (!body) {setimgbody(null); return }
			imgbody && URL.revokeObjectURL(imgbody)
			const bodytxt = URL.createObjectURL(body)
			// const bodytxt = 'data:image/png;base64,' + body.
			console.log(bodytxt)
			setimgbody(bodytxt)
		})()
	}, [imgUrl])
	const [fabOpen, setFabOpen] = useState(false)
	const isRenderingFab = () => { console.log("is rendering fab"); return true}
	const possibly_affected_ways: [string, GeoJSON.Point][] = zip(nearbyWays || [], nearbyPoints || [])
	return (
		<View
			style={styles.page}
		>
			
			{imgbody && <Image contentFit='contain' style={{position: "absolute", zIndex: 1, top: 10, left: 150, width: 100, height: 100}} source={{uri: imgbody, width:100 , height:100 }} /> }
			{/*fab && currentClick1 && isRenderingFab() &&

			 <Fab placement='bottom right' 
				size='lg' 
				className='bg-primary-600 right-2 bottom-4 hover:bg-primary-700 active:bg-primary-800'>
				<FontAwesome6 name="diamond-turn-right" size={30} color={"red"} />
			</Fab>*/}
			{/*fab && currentClick1 && <Portal>
				<FAB.Group
				  style={styles.fab}
				  open={fabOpen}
				  onStateChange={({ open }) => setFabOpen(open)}
				  visible={fab}
				  icon='plus'
				  actions={[
					{icon: (props) => <FontAwesome6 name="diamond-turn-right" size={props.size} color={props.color} />,
						onPress: () => router.navigate("../Add sign?" + new URLSearchParams({traffic_sign: 'hazard', point: JSON.stringify(currentClick1)}).toString() as any)
					},
					{icon: (props) => <Foundation name="prohibited" size={props.size} color={props.color} />,
						onPress: () => console.log("pressed prohibited")
					}
				  ]}
					 />
				</Portal>*/}
			
			{false && imgbody && <RnImage style={{width: 100, height: 100}} source={{uri: imgbody || undefined, width:100 , height:100 }} /> }
			{imgUrl && <Link href={imgUrl as any} asChild><Pressable><Text>View details</Text></Pressable></Link> }
			<MapLibreGL.MapView
				onRegionDidChange={onMapBoundChange}
				ref={(r) => { mapView.current.o = r }}
				style={styles.map}
				logoEnabled={false}
				styleURL="https://raw.githubusercontent.com/go2garret/maps/main/src/assets/json/arcgis_hybrid.json"
				// styleURL="https://tiles.openfreemap.org/styles/liberty"
				onPress={onPress}
			>
				{currentClick && <MapLibreGL.ShapeSource
					id="currentClick"
					shape={currentClick}
					ref={currentClickSource}
					onPress={onPressCancelCurrentClick}
				>
					<MapLibreGL.CircleLayer
						id="currentClicks"
						style={currentClickLayerStyle}
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

				</MapLibreGL.ShapeSource>}
				<MapLibreGL.UserLocation
					visible={isAndroidPermissionGranted || false}
					onUpdate={setUserLocation}
				/>
				<MapLibreGL.Camera
					zoomLevel={16}
					followUserMode={MapLibreGL.UserTrackingMode.Follow}
					followUserLocation
				/>

			</MapLibreGL.MapView>
			<FAB
				visible={!!fab && !!currentClick1}
				onPress={() => currentClick1 && router.navigate("../Add sign?" + prepareSignArgs({traffic_sign: 'hazard hazard=?!', possibly_affected_ways, point: currentClick1}).toString() as any)} 
				placement="right"
				title="Add Sign"
				icon={{ name: 'diamond-turn-right', type: 'font-awesome-6', color: 'white' }}
				color="red"
			/>
		</View>
	);
}
