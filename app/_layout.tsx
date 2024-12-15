import MapLibreGL from '@maplibre/maplibre-react-native';
import { Stack } from "expo-router";
import * as SQLite from "expo-sqlite"
import { Asset } from 'expo-asset';
import React, {useState, useEffect, useRef} from 'react'
import * as Spatialite from "spatialite"
import { SafeAreaProvider } from 'react-native-safe-area-context';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import * as Themed from '@rneui/themed';
import * as ReactQuery from '@tanstack/react-query'

const queryClient = new ReactQuery.QueryClient()

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
      console.log("**************************", r, "moo", shorterpath, localuri, assetpath)
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
		  nodes blob,
		  properties blob,
		  width real
		);
		select AddGeometryColumn('ways', 'geom', 4326, 'LINESTRING');
		select AddGeometryColumn('ways', 'geomgda', 7855, 'LINESTRING');
		select AddGeometryColumn('ways', 'geombuffered', 4326, 'POLYGON');
        select AddGeometryColumn('ways', 'geombufferedgda', 7855, 'POLYGON');
		select CreateSpatialIndex('ways', 'geombuffered');
		select CreateSpatialIndex('ways', 'geom');
		`)

  return projInterlinked
}


export default function RootLayout() {
  useEffect(() => {
	MapLibreGL.setAccessToken(null)
	Themed.registerCustomIconType('font-awesome-6', FontAwesome6)
  })

  return (
	<SafeAreaProvider>
        <ReactQuery.QueryClientProvider client={queryClient}>
          <SQLite.SQLiteProvider databaseName="tism" onInit={activateDb}>
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
          </SQLite.SQLiteProvider>
        </ReactQuery.QueryClientProvider>
	</SafeAreaProvider>
  );
}
