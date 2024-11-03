import React, { useState, useEffect, useRef } from 'react'
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import Foundation from '@expo/vector-icons/Foundation';
import { Portal, FAB } from 'react-native-paper'
import { Text, View, Pressable, StyleSheet, Image as RnImage } from "react-native";
import { Image } from 'expo-image'
import { Link, router } from "expo-router";
import MapLibreGL from '@maplibre/maplibre-react-native';
import type { RegionPayload } from '@maplibre/maplibre-react-native/javascript/components/MapView';
import * as SQLite from 'expo-sqlite'
import * as OsmApi from "ts-output";
import { useDrizzleStudio } from "expo-drizzle-studio-plugin"
import { useAndroidLocationPermission } from '@/components/AndroidLocationPermission';
import OnPressEvent from '@maplibre/maplibre-react-native/javascript/types/OnPressEvent';
import { Asset } from 'expo-asset';

//some weird library infelicity requires this
//
MapLibreGL.setAccessToken(null)

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

class Queries {
	private _neededareas: SQLite.SQLiteStatement | undefined
	private _insertBounds: SQLite.SQLiteStatement | undefined
	private _insertNodes: SQLite.SQLiteStatement | undefined
	private _queryNodes: SQLite.SQLiteStatement | undefined
	private _insertWays: SQLite.SQLiteStatement | undefined
	private _queryWays: SQLite.SQLiteStatement | undefined
	private _findNearbyWays: SQLite.SQLiteStatement | undefined

	constructor() {};

	public get neededareas() { return this._neededareas }
	public set neededareas(theneededareas: SQLite.SQLiteStatement | undefined) {
		this._neededareas?.finalizeAsync()
		this._neededareas = theneededareas
	}

	public get queryNodes() { return this._queryNodes }
	public set queryNodes(theQueryNodes: SQLite.SQLiteStatement | undefined) {
		this._queryNodes?.finalizeAsync()
		this._queryNodes = theQueryNodes
	}

	public get queryWays() { return this._queryWays }
	public set queryWays(theQueryWays: SQLite.SQLiteStatement | undefined) {
		this._queryWays?.finalizeAsync()
		this._queryWays = theQueryWays
	}

	public get insertWays() { return this._insertWays }
	public set insertWays(theinsertWays: SQLite.SQLiteStatement | undefined) {
		this._insertWays?.finalizeAsync()
		this._insertWays = theinsertWays
	}

	public get insertNodes() { return this._insertNodes }
	public set insertNodes(theinsertNodes: SQLite.SQLiteStatement | undefined) {
		this._insertNodes?.finalizeAsync()
		this._insertNodes = theinsertNodes
	}

	public get findNearbyWays() { return this._findNearbyWays }
	public set findNearbyWays(thequery: SQLite.SQLiteStatement | undefined) {
		this._findNearbyWays?.finalizeAsync()
		this._findNearbyWays = thequery
	}
	public get insertBounds() { return this._insertBounds }
	public set insertBounds(theinsertBounds: SQLite.SQLiteStatement | undefined) {
		this._insertBounds?.finalizeAsync()
		this._insertBounds = theinsertBounds
	}

	finalize() {
		 this.neededareas = undefined
		 this.insertBounds = undefined
		 this.findNearbyWays = undefined
		 this.insertNodes = undefined
		 this.queryNodes = undefined
		 this.insertWays = undefined
		 this.queryWays = undefined
	}
}

class JustOnce {
	private others: (() => Promise<any>)[] = []
	private current: Promise<any>|null = null
	private timeout: number = 0

	public take(f: () => Promise<any>) {
		this.others.push(f)
		this.act()
		const timeout = ++this.timeout
		console.log("setting", timeout, this.timeout)
		setTimeout(() => {
			console.log("checking", timeout, this.timeout)
			if (timeout == this.timeout) {
				this.actAlt()
			}
		}, 500)
	}

	private actAlt() {
		const one = this.others.pop()
		if(!one) { console.log("alt none left"); return }
		one()
		console.log("alt taking one while there are others left", this.others.length)
	}

	private act() {
		if (this.current) { console.log("already working"); return }
		const one = this.others.pop()
		if(!one) { console.log("none left"); return }
		let clear = () => {
			this.current = null
			this.act()
		}
		this.current = one().then(clear, clear)
		console.log("taking one, hereafter remain ", this.others.length)
	}
}

const debug = function <T>(msg:string, t: T): T { console.log(msg, t); return t }

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
		(async () => {
			console.log(1)
			let str = require('@/sql/known-bounds.sql.json')
			queries.current.neededareas = await db.prepareAsync(str)
			console.log(2, str, typeof queries.current.neededareas)
			const insert_bounds = require('@/sql/insert-bounds.sql.json')
			console.log("insert bounds", insert_bounds)
			queries.current.insertBounds = await db.prepareAsync(insert_bounds)
			queries.current.findNearbyWays = await db.prepareAsync(require('@/sql/find-nearby-ways.sql.json'))
			queries.current.insertNodes = await db.prepareAsync(require('@/sql/insert-nodes.sql.json'))
			queries.current.insertWays = await db.prepareAsync(require('@/sql/insert-ways.sql.json'))
			queries.current.queryNodes = await db.prepareAsync(require('@/sql/query-nodes.sql.json'))
			queries.current.queryWays = await db.prepareAsync(require('@/sql/query-ways.sql.json'))
		})()

		return () => {
			console.log('finalising')
			queries.current.finalize()
		}
	}, [])

	const justOnce = useRef(new JustOnce())
	const [newData, setNewData] = useState(0)

	useEffect(() => {
		const [deg, c] = typeof mapArea === "string" ? [0, 0] : mapArea

		if (!visibleBounds) return
		if (deg * 10 > c) return

		const [$minlon, $minlat, $maxlon, $maxlat] = visibleBounds

		justOnce.current.take(async () => {
				console.log('begin initiate queries')
				console.log('begin determine area')


				console.log(3, typeof queries.current.neededareas)
				const boundsStr = await (await queries.current.neededareas?.executeAsync({ $minlon, $minlat, $maxlon, $maxlat }))
					?.getFirstAsync() as { difference: string }
				const bounds = JSON.parse(boundsStr.difference) as GeoJSON.Polygon

				console.log('are determined', boundsStr, bounds)

				if (bounds && bounds?.coordinates.length !== 0) {
					const [minlon, minlat, maxlon, maxlat] = bounds ? bounds.bbox! : [$minlon, $minlat, $maxlon, $maxlat]
					console.log('begin api/0.6/map')
					const b = await OsmApi.getApi06MapText({ minlon, minlat, maxlon, maxlat })
					console.log('complete api/0.6/map')
					console.log('insert initiated')
					await queries.current.insertBounds?.executeAsync({ '$json': b })
					console.log('insert bounds a great success')
					await queries.current.insertNodes?.executeAsync(b)
					console.log('insert nodes a great success')
					await queries.current.insertWays?.executeAsync(b)
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
				console.log('queries initiated')
				const highwayStop: GeoJSON.Feature<GeoJSON.Point, OsmApi.INode>[] | undefined
					= ((await (await queries.current.queryNodes?.executeAsync())?.getAllAsync()) as { geojson: string }[])
						?.map(geo => { 
							const r: GeoJSON.Feature<GeoJSON.Point, OsmApi.INode> = JSON.parse(geo.geojson) 
							r.id = r.properties.id.toString()
							return r
						})

				const roadCasings: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay>[] | undefined
					= ((await (await queries.current.queryWays?.executeAsync({$minlon, $minlat, $maxlon, $maxlat}))?.getAllAsync()) as { geojson: string }[])
						?.map(geo => { 
							const r: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay> = JSON.parse(geo.geojson) 
							r.id = r.properties.id.toString()
							return r
						})
				console.log('query and parse complete')
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

			const ways1 = await queries.current.findNearbyWays?.executeAsync({"$lat": currentClick1.coordinates[1], "$lon": currentClick1.coordinates[0]})
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
		setFab(!!nearbyWays?.length || !!nearbyPoints?.length)
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
	return (
		<View
			style={styles.page}
		>
			
			{imgbody && <Portal><Image contentFit='contain' style={{top: 150, left: 150, width: 100, height: 100}} source={{uri: imgbody, width:100 , height:100 }} /></Portal> }
			{fab && currentClick1 && <Portal>
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
				</Portal>}
			
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
		</View>
	);
}

