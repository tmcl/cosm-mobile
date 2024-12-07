import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{title: "Navigate"}} />
      <Tabs.Screen name="About" />
    </Tabs>
  );
}
