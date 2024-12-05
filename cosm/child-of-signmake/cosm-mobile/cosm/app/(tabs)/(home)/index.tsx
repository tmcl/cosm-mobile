import { Text, View, Pressable } from "react-native";
import { Link } from "expo-router";
import {FAB} from '@rneui/themed'
import {useState} from 'react'

export default function Index() {
  const [fab, setFab] = useState(true)
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
			<FAB
				visible={fab}
				onPress={() => setFab(!fab)} 
				placement="right"
				title="Hide"
				icon={{ name: 'delete', color: 'white' }}
				color="red"
			/>
      <Text>Select the app/index.tsx to change this screen.</Text>
			<Link href="/details" asChild><Pressable><Text>View details</Text></Pressable></Link>
    </View>
  );
}
