import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{title: "Navigatrix"}} />
       <Tabs.Screen name="Review" />
      <Tabs.Screen name="About" />
    </Tabs>
  );
}
