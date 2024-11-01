import React, {useState, useEffect, useRef} from 'react'
import { Text, View, Pressable, StyleSheet } from "react-native";
import { Link } from "expo-router";
import MapLibreGL from '@maplibre/maplibre-react-native';
import type {RegionPayload} from '@maplibre/maplibre-react-native/javascript/components/MapView';
import * as SQLite from 'expo-sqlite'
import * as OsmApi from "ts-output";
import { useDrizzleStudio } from "expo-drizzle-studio-plugin"
import { Asset } from 'expo-asset';

//some weird library infelicity requires this
//
MapLibreGL.setAccessToken(null)

const roadcasingsLayerStyle: MapLibreGL.FillLayerStyle = ({
	fillColor: "red",
	fillOpacity: 0.48,
})

const circleLayerStyle: MapLibreGL.CircleLayerStyle = ({
	circleColor: "green",
	circleOpacity: 0.84,
	circleStrokeWidth: 2,
	circleStrokeColor: "white",
	circleRadius: 5,
	circlePitchAlignment: "map"
})

let spatialite: {db: SQLite.SQLiteDatabase, spatialite_info: {spatialite_version: string, proj_version: string, target_cpu: string} } |null = null

const activateDb = (async () => {
	const db = await SQLite.openDatabaseAsync('datbase', {enableCRSQLite: true})
	const reslt2 = await db.getFirstAsync(
		`
		SELECT sqlite_compileoption_used('ENABLE_LOAD_EXTENSION') as r;
		`
	) as {r: unknown}
	
	const reslt3 = await db.getFirstAsync(
		`
		select load_extension('mod_spatialite' ) as r;
		`
	) as {r: unknown}
	const asset = Asset.fromModule(require('../../assets/proj.db'))
	await asset.downloadAsync();
	const assetpath = await asset.uri
	const localuri = await asset.localUri
	const shorterpath = localuri?.substring(7)
	console.log("assetpath", assetpath, localuri)
	var projQuery;
	try {
		projQuery = await db.prepareAsync(
			`
			select proj_setdatabasepath( ? ) as r;
			select bufferoptions_setendcapstyle('flat');
			`
		)
		const r = await (await projQuery.executeAsync(shorterpath!)).getAllAsync()
		console.log(r, "moo")
	} finally {
		projQuery && await projQuery.finalizeAsync()
	}
	const hasData = await db.getFirstAsync("SELECT count(name) as hasData FROM sqlite_master WHERE type='table' AND name='spatial_ref_sys';"
	) as {hasData: number}
	   
	if (!hasData.hasData) {
		await db.execAsync("SELECT initspatialmetadata()")
	}
	const result = await db.execAsync(
		`
		drop table if exists bounds;
		create table if not exists bounds (
		  observed datetime,
		  geom blob,
		  everything text,
		  bounds text,
		  minlon text,
		  minlat text,
		  maxlon text,
		  maxlat text
		);
		select AddGeometryColumn('bounds', 'geom', 4326, 'POLYGON');
		create table if not exists test(id integer primary key not null);
		drop table if exists nodes;
		create table if not exists nodes(
		  id integer primary key not null,
		  observed datetime,
		  version integer,
		  geom blob,
		  properties blob
		);
		select AddGeometryColumn('nodes', 'geom', 4326, 'POINT');
		drop table if exists ways;
		create table if not exists ways(
		  id integer primary key not null,
		  observed datetime,
		  version integer,
		  geom blob,
		  geomgda blob,
		  geombuffered blob,
		  nodes blob,
		  properties blob,
		  width real
		);
		select AddGeometryColumn('ways', 'geom', 4326, 'LINESTRING');
		select AddGeometryColumn('ways', 'geomgda', 7855, 'LINESTRING');
		select AddGeometryColumn('ways', 'geombuffered', 4326, 'LINESTRING');
		`)
	
	const spatialite_info = await db.getFirstAsync(
		`
		select spatialite_version() as spatialite_version, proj_version() as proj_version, spatialite_target_cpu() as target_cpu;
		`
	) as {spatialite_version: string, proj_version: string, target_cpu: string}

	return {db, spatialite_info}
})().then(info => spatialite = info)



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
	 latitude: number|null
	 longitude: number|null
	 screenPointX: number
	 screenPointY: number
}

type UserLocation = MapLibreGL.Location

const defaultLocation : UserLocation = {
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

const isValidLastClick = (click: Click) => typeof click.latitude  === 'number' && typeof click.longitude === 'number'

const showUserLocation = (locn: UserLocation) => {
	if (locn.timestamp == 0) {
		return null
	} else {
		return [<Text key="1">Latitude: {locn.coords.latitude};Longitude: {locn.coords.longitude};Altitude: {locn.coords.altitude}; Accuracy: {locn.coords.accuracy}; Speed: {locn.coords.speed}; Timestamp: {locn.timestamp}; Heading: {locn.coords.heading}</Text>,
			<Text key="2">{JSON.stringify(locn)}</Text>
		]
	}
}

const lastClick = (click: Click) => {
	if (!isValidLastClick(click)) {
		return <Text>Try to tap the map!</Text>
	} else {
		return <Text>Latitude: {click.latitude};Longitude: {click.longitude};Screen Point X: {click.screenPointX};Screen Point Y: {click.screenPointY}</Text>
	}
}

export default function Sottings() {
	useDrizzleStudio(spatialite?.db || null)
	const [location, setLocation] = useState<Click>({latitude: null, longitude: null, screenPointX: 0, screenPointY: 0})

	const onPress = (event: GeoJSON.Feature<GeoJSON.Point>) => {
		const {geometry, properties} = event;
		setLocation({
			latitude: geometry.coordinates[1],
			longitude: geometry.coordinates[0],
			screenPointX: properties?.screenPointX,
			screenPointY: properties?.screenPointY
		})
	}

    const [userLocation, setUserLocation] = useState(defaultLocation);

	const [isAndroidPermissionGranted, setAndroidPermissionGranted] = useState<boolean|null>(null);
	const [versionList, setVersionList] = useState<(OsmApi.OsmStandard & OsmApi.JSONApiVersions) | null>(null);
	const [capabilitiesList, setCapabilitiesList] = useState<(OsmApi.ApiCapabilities) | null>(null);

	const [elements, setElements] = useState<OsmApi.BoundedElements|null>(null)

	const [mapBound, setMapBound] = useState<GeoJSON.Feature<GeoJSON.Point, RegionPayload>|null>(null)

	const [mapArea, setMapArea] = useState<[number, number]|"unknown"|"unloaded">("unknown")

	const [symbols, setSymbols] = useState<GeoJSON.FeatureCollection<GeoJSON.Point, OsmApi.INode>|null>(null)
	const [roadcasings, setRoadcasings] = useState<GeoJSON.FeatureCollection<GeoJSON.Polygon, OsmApi.IWay>|null>(null)

	const onMapBoundChange = (feature: GeoJSON.Feature<GeoJSON.Point, RegionPayload>) => {
		if (!spatialite || !spatialite.db) return;
		const c = capabilitiesList && capabilitiesList.api.area.maximum
		if(!c ) return;
		console.log('observed map bounds change')
		const [ne, sw] = feature.properties.visibleBounds
		const $maxlon = ne[0]
		const $maxlat = ne[1]
		const $minlon = sw[0]
		const $minlat = sw[1]
		const ew = ne[0] - sw[0]
		const ns = ne[1] - sw[1]
		const deg = ns * ew
		if (typeof mapArea != "string" && mapArea[0] == deg) 
			return;
		setMapArea([deg, c])
		if (deg/10 < c) {
			;(async () => {
				let neededareas, insertBounds, insertNodes, queryNodes, insertWays, queryWays;
				try {
					console.log('begin initiate queries')
					console.log('begin determine area')

					neededareas = await spatialite?.db.prepareAsync(`
						with known as (select min(observed) observed, st_union(geom) known from bounds union select '2024-01-01 01:01:01', st_envelope(makepoint(0, 0)) )
						select max(observed), $minlon as minlon, asgeojson(known.known) as unio, asgeojson(st_difference(st_envelope(makeline(makepoint($minlon, $minlat, 4326), makepoint($maxlon, $maxlat, 4326))), known.known), 15, 1) as difference
						from known 
						where known.known is not null
						`)

                    const boundsStr = await (await neededareas?.executeAsync({$minlon, $minlat, $maxlon, $maxlat}))
						?.getFirstAsync() as {difference: string }
						const bounds = JSON.parse(boundsStr.difference) as GeoJSON.Polygon

					console.log('are determined', boundsStr, bounds)

						if (bounds && bounds?.coordinates.length !== 0) {
							const [minlon, minlat, maxlon, maxlat] = bounds ? bounds.bbox! : [$minlon, $minlat, $maxlon, $maxlat]
							console.log('begin api/0.6/map')
							const b = await OsmApi.getApi06MapText({minlon, minlat, maxlon, maxlat })
							console.log('complete api/0.6/map')
					insertBounds = await spatialite?.db.prepareAsync(`
						insert into bounds (observed, geom, 
		  everything ,
		  bounds ,
		  minlon ,
		  minlat ,
		  maxlon ,
		  maxlat 
						) values 
						(datetime(), st_envelope(makeline(makepoint($json -> 'bounds' ->> 'minlon', $json -> 'bounds' ->> 'minlat', 4326), makepoint($json -> 'bounds' ->> 'maxlon', $json -> 'bounds' ->> 'maxlat', 4326))),
						$json,
						$json->'bounds',
						$json->'bounds'->'minlon',
						$json->'bounds'->'minlat',
						$json->'bounds'->'maxlon',
						$json->'bounds'->'maxlat'
						);
						`)

					insertNodes = await spatialite?.db.prepareAsync(`
					    insert or replace into nodes (id, observed, geom, version, properties)
						select t.value ->> 'id', 
						       datetime(), 
							   MakePoint(t.value->>'lon', t.value->>'lat', 4326) as makepoint,
							   t.value->> 'version', 
							   jsonb(t.value)
						from json_each(?, '$.elements') as t
						where t.value->>'type' = 'node';
						`)

					insertWays = await spatialite?.db.prepareAsync(`
						with data as (
							select t.value ->> 'id' as id, 
								datetime() as observed, 
								setsrid(MakeLine(nodes.geom order by n.key), 4326) as geom,
								t.value->> 'version' as version, 
								jsonb(t.value -> 'nodes') as nodes,
								jsonb(t.value) as properties,
								coalesce(t.value -> 'tags' ->> 'width', t.value->'tags'->>'lanes'*3.5, case when t.value->'tags'->>'highway' = 'footway' then 2 when coalesce(t.value->'tags'->>'oneway', 'no') = 'no' then 7 else 3.5 end) as width
							from json_each(?, '$.elements') as t
								join json_each(t.value -> 'nodes') n
								join nodes on nodes.id = n.value
							where t.value->>'type' = 'way' and t.value->'tags' ->> 'highway' is not null
							group by t.value ->> 'id'
						)
					    insert or replace into ways (id, observed, geom, geomgda, geombuffered, version, nodes, properties, width)
						select  id, 
						    observed,
						    geom,
							transform(geom, 7855) as geomgda,
							transform(buffer(transform(geom, 7855), width/2), 4326) as geombuffered,
							version,
							nodes,
							properties,
							width
						from data
						;
						`)
					console.log('insert initiated')
					await insertBounds?.executeAsync({'$json': b})
					await insertNodes?.executeAsync(b)
					await insertWays?.executeAsync(b)
					console.log('insert complete')
						} else {
					console.log('no insert')
						}

					queryNodes = await spatialite?.db.prepareAsync(`
						select json_object(
						  'type', 'Feature', 
						  'geometry', json(asgeojson(geom)), 
						  'properties', json(properties)) as geojson
						from nodes
						where properties->>'type' = 'node' and properties -> 'tags' ->> 'highway' = 'stop'
						limit 1000
						`)
					queryWays = await spatialite?.db.prepareAsync(`
						select json_object(
						  'type', 'Feature', 
						  'geometry', json(asgeojson(geombuffered)), 
						  'properties', json(properties)) as geojson
						from ways
						limit 1000
						`)
					console.log('queries initiated')
					const highwayStop: GeoJSON.Feature<GeoJSON.Point, OsmApi.INode>[] | undefined
					            = ((await (await queryNodes?.executeAsync())?.getAllAsync()) as {geojson: string}[])
								  ?.map(geo => JSON.parse(geo.geojson))
					const roadCasings: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay>[] | undefined
					            = ((await (await queryWays?.executeAsync())?.getAllAsync()) as {geojson: string}[])
								  ?.map(geo => JSON.parse(geo.geojson))
					console.log('query and parse complete')
				    setSymbols({type: "FeatureCollection", features: highwayStop})
				    setRoadcasings({type: "FeatureCollection", features: roadCasings})
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
				} finally {
					insertBounds?.finalizeAsync()
					insertNodes?.finalizeAsync()
					queryNodes?.finalizeAsync()
					insertWays?.finalizeAsync()
					queryWays?.finalizeAsync()
				}
				// setSymbols({type: "FeatureCollection", features: filtered})
				// console.log({type: "FeatureCollection", features: filtered})

			})()
		}
	}

	const mapView = useRef<{o: MapLibreGL.MapViewRef|null}>({o: null})

	useEffect( () => {
		(async() => {
			const r = await OsmApi.getApiVersions();
			setVersionList(r)
		})()
	}, [])

	useEffect( () => {
		(async() => {
			const knownVersion: "0.6" = "0.6"
			if (versionList && versionList.api.versions.includes(knownVersion)) {
				const r =await OsmApi.getApi06Capabilities()
				setCapabilitiesList(r)
			}
		})()
	}, [versionList])

	useEffect(() => {
		const getPermission = async () => {
			const isGranted = await MapLibreGL.requestAndroidLocationPermissions();
			setAndroidPermissionGranted(isGranted)
		}
		getPermission()
	}, [])

	useEffect(() => {
		(async() => {
			const lat = userLocation.coords
		})()
	}, [capabilitiesList])

	const showMapArea = typeof mapArea == "string" ? mapArea : mapArea.join(" vs ")
	const morestuff = <Text>{showMapArea}</Text>

	const apiversion = versionList && <>
		<Text>version {versionList.version}</Text>
		<Text>generator {versionList.generator}</Text>
		<Text>copyright {versionList.copyright}</Text>
		<Text>attribution {versionList.attribution}</Text>
		<Text>licence {versionList.license}</Text>
		<Text>versions {versionList.api.versions}</Text>
		</>

//		const getPermission = async () => {
//		const isGranted = await MapLibreGL.requestAndroidLocationPermissions();
//		setAndroidPermissionGranted(isGranted)
//	}
//	getPermission()}, [])

  const highwaystopSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const roadcasingsSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const permission = <Text>{isAndroidPermissionGranted === null ? "checking permission" : (isAndroidPermissionGranted ? "got permission" : "refused permission")}</Text>
  return (
    <View
      style={styles.page}
    >
		  {apiversion}
		  {morestuff}
		  {permission}
			{lastClick(location)}
			{showUserLocation(userLocation)}
			<Link href="/details" asChild><Pressable><Text>View details</Text></Pressable></Link>
			<MapLibreGL.MapView
			  onRegionDidChange={onMapBoundChange}
			  ref={(r) => {  mapView.current.o = r } }
			  style={styles.map}
				logoEnabled={false}
				styleURL="https://raw.githubusercontent.com/go2garret/maps/main/src/assets/json/arcgis_hybrid.json"
				// styleURL="https://tiles.openfreemap.org/styles/liberty"
				onPress={onPress}
			>
				{symbols && <MapLibreGL.ShapeSource
				id="highwaystop"
				shape={symbols}
				ref={highwaystopSource}
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

