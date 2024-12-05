import MapLibreGL from '@maplibre/maplibre-react-native';
import { Stack } from "expo-router";
import * as SQLite from "expo-sqlite"
import { Asset } from 'expo-asset';
import React, {useState, useEffect, useRef} from 'react'
import { MainContext, appState } from "@/components/MainContext";
import * as Spatialite from "spatialite"
import { SafeAreaProvider } from 'react-native-safe-area-context';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import * as Themed from '@rneui/themed';

const activateDb = (db: SQLite.SQLiteDatabase) => {
  db.getFirstSync( ` pragma journal_mode=WAL `) 
  Spatialite.initializeDb(db)
  db.getFirstSync( ` select bufferoptions_setendcapstyle('flat'); `) 

	const asset = Asset.fromModule(require('../assets/proj.db'))
	const projInterlinked = asset.downloadAsync().then(async () => {
    const assetpath = await asset.uri
    const localuri = await asset.localUri
    const shorterpath = localuri?.substring(7)
    console.log("assetpath", assetpath, localuri)
    var projQuery;
    try {
      projQuery = await db.prepareAsync( ` select proj_setdatabasepath( ? ) as r; `)
      const r = await (await projQuery.executeAsync(shorterpath!)).getAllAsync()
      console.log(r, "moo")
    } finally {
      projQuery && await projQuery.finalizeAsync()
    }
  })
	const hasData = db.getFirstSync("SELECT count(name) as hasData FROM sqlite_master WHERE type='table' AND name='spatial_ref_sys';"
	) as {hasData: number}
	   
	if (!hasData.hasData) {
		db.execSync("SELECT initspatialmetadata()")
	}
	db.execSync(
		`
		drop table nodes_ways;
		create table if not exists nodes_ways ( 
			observed text,
			node_id int,
			way_id int,
			ordering int, 
			version int
		);
		create index if not exists ix_nodes_ways_node on nodes_ways ( node_id );
		create index if not exists ix_nodes_ways_way on nodes_ways ( way_id );
		create unique index if not exists ix_nodes_ways_way_node on nodes_ways ( way_id, node_id );
		-- drop table if exists bounds;
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
		-- drop table if exists nodes;
		create table if not exists nodes(
		  id integer primary key not null,
		  observed datetime,
		  version integer,
		  geom blob,
		  properties blob
		);
		select AddGeometryColumn('nodes', 'geom', 4326, 'POINT');
		-- drop table if exists ways;
		create table if not exists ways(
		  id integer primary key not null,
		  observed datetime,
		  version integer,
		  geom blob,
		  geomgda blob,
		  geombuffered blob,
		  geombufferedgda blob,
		  nodes blob,
		  properties blob,
		  width real
		);
		select AddGeometryColumn('ways', 'geom', 4326, 'LINESTRING');
		select AddGeometryColumn('ways', 'geomgda', 7855, 'LINESTRING');
		select AddGeometryColumn('ways', 'geombuffered', 4326, 'LINESTRING');
		`)
	
	const spatialite_info = db.getFirstSync(
		`
		select spatialite_version() as spatialite_version, proj_version() as proj_version, spatialite_target_cpu() as target_cpu;
		`
	) as {spatialite_version: string, proj_version: string, target_cpu: string}

  return projInterlinked
}


export default function RootLayout() {
  const [state, updateState] = useState(appState)
  
  useEffect(() => {
	MapLibreGL.setAccessToken(null)
	Themed.registerCustomIconType('font-awesome-6', FontAwesome6)
  })

  return (
	<SafeAreaProvider>
      <SQLite.SQLiteProvider databaseName="datbase" onInit={activateDb}>
        <MainContext.Provider value={state}>
          <Stack screenOptions={{
                    headerStyle: {
                backgroundColor: '#f4511e',
              },
              headerTintColor: '#fff',
              headerTitleStyle: {
                fontWeight: 'bold',
              },
          }}>
            <Stack.Screen options={{headerShown: false}} name="(tabs)" />
          </Stack>
        </MainContext.Provider>
      </SQLite.SQLiteProvider>
	</SafeAreaProvider>
  );
}
