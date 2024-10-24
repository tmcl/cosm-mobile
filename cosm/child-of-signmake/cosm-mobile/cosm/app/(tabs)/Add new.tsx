import React, {useState, useEffect} from 'react'
import { Text, View, Pressable, Button } from "react-native";
import { Link } from "expo-router";
import * as SQLite from 'expo-sqlite'


export default function Settings() {
	const [log, setLog] = useState("log")
	useEffect(() => {
		(async () => {
			setLog("waiting")
		const db = await SQLite.openDatabaseAsync('datbase', {enableCRSQLite: true})
			setLog("connected")
			const result = await db.execAsync(
				`
				create table if not exists test(id integer primary key not null)
			 	`)
			const reslt2 = await db.getFirstAsync(
				`
				SELECT sqlite_compileoption_used('ENABLE_LOAD_EXTENSION') as r;
				`
			)
			setLog(`hello all: ${reslt2.r}`)
			const reslt3 = await db.getFirstAsync(
				`
				select load_extension('mod_spatialite' ) as r;
				`
			)
			setLog(`hello all: ${reslt3.r}`)
			const reslt4 = await db.getFirstAsync(
				`
				select spatialite_version() as r1, proj_version() as r2, spatialite_target_cpu() as r;
				`
			)
			setLog(`hello all: ${reslt4.r1} ${reslt4.r2} ${reslt4.r}`)
		})()
	}, [])
	var onPress = () => "hi"
  return (
    <View 
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text>{log}</Text>
			<Link href="/details" asChild><Pressable><Text>View details</Text></Pressable></Link>
			<Button title="My Button" onPress={onPress}>Button</Button>
    </View>
  );
}

