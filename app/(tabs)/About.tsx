import React, {useState, useEffect} from 'react'
import { Text, View, Button } from "react-native";
import * as SQLite from 'expo-sqlite'
import { useAndroidLocationPermission } from '@/components/AndroidLocationPermission';
import {getApi06PermissionsText} from "@/scripts/clients.2";

export default function Settings() {
	const [log, setLog] = useState("log")
	const [permissions, setPermissions] = useState("no permissions yet")
	const db = SQLite.useSQLiteContext()
	useEffect(() => {
		(async () => {
			setLog("got connection")
			const reslt2 = await db.getFirstAsync(
				`
				SELECT sqlite_compileoption_used('ENABLE_LOAD_EXTENSION') as r;
				`
			) as {r: unknown}
			setLog(`hello all: ${reslt2.r}`)
			const reslt3 = await db.getFirstAsync(
				`
				select load_extension('mod_spatialite' ) as r;
				`
			) as {r: unknown}
			setLog(`hello all: ${reslt3.r}`)
			const reslt4 = await db.getFirstAsync(
				`
				select sqlite_version() as r0, spatialite_version() as r1, proj_version() as r2, spatialite_target_cpu() as r3;
				`
			) as {r0: unknown, r1: unknown, r2: unknown, r3: unknown}
			setLog(`hello all: ${reslt4.r0} ${reslt4.r1} ${reslt4.r2} ${reslt4.r3}`)
		})()
	}, [db])

  const [isAndroidPermissionGranted, setAndroidPermissionGranted] = useState<boolean|null>(null);
  useAndroidLocationPermission(setAndroidPermissionGranted)
  const permission = <Text>{isAndroidPermissionGranted === null ? "checking permission" : (isAndroidPermissionGranted ? "got permission" : "refused permission")}</Text>

	const buttonPress = async () => {
		try {
			console.log('x')
			const r = await getApi06PermissionsText()
			console.log(r)
			setPermissions(JSON.stringify(r))
		} catch (e) {
			console.log(e)
			setPermissions(JSON.stringify(e))
		}
	}

  return (
    <View 
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
		  {permission}
      <Text>{log}</Text>
		 <Button title="Check Permissions" onPress={buttonPress} />
		 <Text>{permissions}</Text>

    </View>
  );
}

