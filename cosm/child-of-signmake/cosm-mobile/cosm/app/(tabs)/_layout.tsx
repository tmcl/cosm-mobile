import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="Add new" />
      <Tabs.Screen name="sottings" />
    </Tabs>
  );
}
