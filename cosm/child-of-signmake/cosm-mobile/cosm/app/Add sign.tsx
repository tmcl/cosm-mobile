import React, {useState, useEffect} from 'react'
import { TextInput , Text, View, Pressable, Button } from "react-native";
import { List, TextInput as RnPTextInput } from "react-native-paper";
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
			<RnPTextInput style={{height: 40, flex: 1}} dense={true} numberOfLines={1} label="Sign type" value="hi" /> 
			</View>
			<List.Section>
				<List.Subheader>Add sign</List.Subheader>
				<List.Item title="item" right={() => <TextInput></TextInput>}/>

			</List.Section>
    </View>
  );
}

