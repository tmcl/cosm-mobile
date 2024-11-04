import React, {useState, useEffect} from 'react'
import { TextInput , Text, View, Pressable, Button } from "react-native";
import { Link, useLocalSearchParams } from "expo-router";
import * as SQLite from 'expo-sqlite'


export default function Settings() {
	const searchParams = useLocalSearchParams()
	const db = SQLite.useSQLiteContext()


  return (
    <View 
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
		    <Text>Welcome to the add sign view</Text>
		    <Text>{JSON.stringify(searchParams)}</Text>
			<Link href="/details" asChild><Pressable><Text>View details</Text></Pressable></Link>
			<View style={{height:80, flexDirection: "row", margin:16}}>
			</View>
    </View>
  );
}

