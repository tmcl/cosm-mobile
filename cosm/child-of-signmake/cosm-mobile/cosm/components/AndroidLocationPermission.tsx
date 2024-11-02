
import MapLibreGL from '@maplibre/maplibre-react-native';
import React, {useState, useEffect, useRef} from 'react'

export const useAndroidLocationPermission = (setAndroidPermissionGranted: (isGranted: boolean) => void) => {
	useEffect(() => {
		const getPermission = async () => {
			const isGranted = await MapLibreGL.requestAndroidLocationPermissions();
			setAndroidPermissionGranted(isGranted)
		}
		getPermission()
	}, [])
}
