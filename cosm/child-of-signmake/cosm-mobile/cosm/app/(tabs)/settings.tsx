import { Text, View, Pressable } from "react-native";
import { Link } from "expo-router";

export default function Settings() {
  return (
    <View 
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text>Seloct app/index.tsx to change this screen.</Text>
			<Link href="/details" asChild><Pressable><Text>View details</Text></Pressable></Link>
    </View>
  );
}

