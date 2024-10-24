import React, {useState, useEffect} from 'react'
import { Text, View, Pressable, StyleSheet } from "react-native";
import { Link } from "expo-router";
import MapLibreGL from '@maplibre/maplibre-react-native';

//some weird library infelicity requires this
//
MapLibreGL.setAccessToken(null)

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

	useEffect(() => {
		const getPermission = async () => {
			const isGranted = await MapLibreGL.requestAndroidLocationPermissions();
			setAndroidPermissionGranted(isGranted)
		}
		getPermission()
	}, [])
//		const getPermission = async () => {
//		const isGranted = await MapLibreGL.requestAndroidLocationPermissions();
//		setAndroidPermissionGranted(isGranted)
//	}
//	getPermission()}, [])

  const permission = <Text>{isAndroidPermissionGranted === null ? "checking permission" : (isAndroidPermissionGranted ? "got permission" : "refused permission")}</Text>
  return (
    <View
      style={styles.page}
    >
		  {permission}
			{lastClick(location)}
			{showUserLocation(userLocation)}
			<Link href="/details" asChild><Pressable><Text>View details</Text></Pressable></Link>
			<MapLibreGL.MapView
			  style={styles.map}
				logoEnabled={false}
				styleURL="https://tiles.openfreemap.org/styles/liberty"
				onPress={onPress}
			>
			{isAndroidPermissionGranted && <MapLibreGL.UserLocation
				 visible={isAndroidPermissionGranted}
				 onUpdate={setUserLocation}
				/>}
			{isAndroidPermissionGranted && <MapLibreGL.Camera
				 zoomLevel={16}
				 followUserMode={MapLibreGL.UserTrackingMode.Follow}
				 followUserLocation
				/>}

			</MapLibreGL.MapView>
    </View>
  );
}

