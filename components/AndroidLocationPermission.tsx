
import MapLibreGL from '@maplibre/maplibre-react-native';
import {useEffect} from 'react'

export const useAndroidLocationPermission = (setAndroidPermissionGranted: undefined|((isGranted: boolean) => void)) => {
	useEffect(() => {
		const getPermission = async () => {
			const isGranted = await MapLibreGL.requestAndroidLocationPermissions();
			setAndroidPermissionGranted && setAndroidPermissionGranted(isGranted)
		}
		getPermission()
	}, [setAndroidPermissionGranted])
}
