import React, { useState, useEffect, useRef } from 'react'
import { Text, View, Pressable, StyleSheet } from "react-native";
import { Image} from 'expo-image'
import { Link } from "expo-router";
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

const roadcasingsLayerStyle: MapLibreGL.FillLayerStyle = ({
	fillColor: "red",
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

const circleLayerStyle: MapLibreGL.CircleLayerStyle = ({
	circleColor: "green",
	circleOpacity: 0.84,
	circleStrokeWidth: 2,
	circleStrokeColor: "white",
	circleRadius: 5,
	circlePitchAlignment: "map"
})





const styles = StyleSheet.create({
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

	public get insertBounds() { return this._insertBounds }
	public set insertBounds(theinsertBounds: SQLite.SQLiteStatement | undefined) {
		this._insertBounds?.finalizeAsync()
		this._insertBounds = theinsertBounds
	}

	finalize() {
		 this.neededareas = undefined
		 this.insertBounds = undefined
		 this.insertNodes = undefined
		 this.queryNodes = undefined
		 this.insertWays = undefined
		 this.queryWays = undefined
	}
}

class JustOnce {
	private others: (() => Promise<any>)[] = []
	private current: Promise<any>|null = null
	private alternative: Promise<any>|null = null
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
		}, 500_000)
	}

	private actAlt() {
		if (this.alternative) { console.log("alt already working"); return }
		const one = this.others.pop()
		if(!one) { console.log("alt none left"); return }
		let clear = () => {
			this.alternative = null
			this.act()
		}
		this.alternative = one().then(clear, clear)
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
		console.log("taking one while there are others left", this.others.length)
	}
}

export default function Sottings() {
	const db = SQLite.useSQLiteContext()
	const queries = useRef(new Queries())
	useDrizzleStudio(db)

	const onPress = (event: GeoJSON.Feature<GeoJSON.Point>) => {
		const { geometry, properties } = event;
		setCurrentClick({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry }] })
		console.log('press space', geometry, properties)
	}

	const [userLocation, setUserLocation] = useState(defaultLocation);

	const [versionList, setVersionList] = useState<(OsmApi.OsmStandard & OsmApi.JSONApiVersions) | null>(null);
	const [capabilitiesList, setCapabilitiesList] = useState<(OsmApi.ApiCapabilities) | null>(null);

	const [mapArea, setMapArea] = useState<[number, number] | "unknown" | "unloaded">("unknown")

	const [symbols, setSymbols] = useState<GeoJSON.FeatureCollection<GeoJSON.Point, OsmApi.INode> | null>(null)
	const [currentClick, setCurrentClick] = useState<GeoJSON.FeatureCollection<GeoJSON.Point, {}> | null>(null)
	const [roadcasings, setRoadcasings] = useState<GeoJSON.FeatureCollection<GeoJSON.Polygon, OsmApi.IWay> | null>(null)

	const [visibleBounds, setVisibleBounds] = useState<GeoJSON.BBox | null>(null)

	useEffect(() => {
		(async () => {
			console.log(1)
			let str = require('@/sql/known-bounds.sql.json')
			queries.current.neededareas = await db.prepareAsync(str)
			console.log(2, str, typeof queries.current.neededareas)
			const insert_bounds = require('@/sql/insert-bounds.sql.json')
			console.log("insert bounds", insert_bounds)
			queries.current.insertBounds = await db.prepareAsync(insert_bounds)
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
				} else {
					console.log('no insert')
				}

				console.log('queries initiated')
				const highwayStop: GeoJSON.Feature<GeoJSON.Point, OsmApi.INode>[] | undefined
					= ((await (await queries.current.queryNodes?.executeAsync())?.getAllAsync()) as { geojson: string }[])
						?.map(geo => JSON.parse(geo.geojson))
				const roadCasings: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay>[] | undefined
					= ((await (await queries.current.queryWays?.executeAsync())?.getAllAsync()) as { geojson: string }[])
						?.map(geo => JSON.parse(geo.geojson))
				console.log('query and parse complete')
				setSymbols({ type: "FeatureCollection", features: highwayStop })
				setRoadcasings({ type: "FeatureCollection", features: roadCasings })
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

			})
	}, [visibleBounds])

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

	const onPressCancelCurrentClick = () => { setCurrentClick(null) }
	const highwaystopSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const currentClickSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const roadcasingsSource = useRef<MapLibreGL.ShapeSourceRef>(null)
	const [isAndroidPermissionGranted, setAndroidPermissionGranted] = useState<boolean | null>(null);
	useAndroidLocationPermission(setAndroidPermissionGranted)
	const [imageTags, setImageTags] = useState<{nsiId: number, nsiLatLon: [number, number], nsiBasicTags: {[ix: string]: string}}|null>(null)
	const onPressFeature = (e: OnPressEvent) => {
		console.log('pressed', e.coordinates, e.point, e.features, e.features[0].properties?.tags)
		setImageTags({nsiId: e.features[0].properties?.id, nsiLatLon: [e.coordinates.latitude, e.coordinates.longitude], nsiBasicTags: e.features[0].properties?.tags})
	}
	return (
		<View
			style={styles.page}
		>
			{imageTags && <Image source={"http://192.168.4.55:8004/sign/from-json?tags=" + encodeURIComponent(JSON.stringify(imageTags)} /> }
			<Link href="/details" asChild><Pressable><Text>View details</Text></Pressable></Link>
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
						style={circleLayerStyle}
					/>

				</MapLibreGL.ShapeSource>}
				{roadcasings && <MapLibreGL.ShapeSource
					id="roadcasing"
					shape={roadcasings}
					ref={roadcasingsSource}
				>
					<MapLibreGL.FillLayer
						id="roadcasingfill"
						style={roadcasingsLayerStyle}
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

