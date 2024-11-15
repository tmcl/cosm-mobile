import { View, Text, StyleSheet } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';

export default function DetailsScreen() {
  return (
    <View style={styles.container}>
      <Text>Details</Text>
			<MapLibreGL.MapView
				logoEnabled={false}
				styleURL="https://raw.githubusercontent.com/go2garret/maps/main/src/assets/json/arcgis_hybrid.json"
				// styleURL="https://tiles.openfreemap.org/styles/liberty"
			>
				<MapLibreGL.Camera
					zoomLevel={16}
					followUserMode={MapLibreGL.UserTrackingMode.Follow}
					followUserLocation
				/>

			</MapLibreGL.MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
