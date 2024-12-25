import {View} from "react-native"
import {useQuery} from "@tanstack/react-query"
import {Text, ListItem} from "@rneui/themed"
import {useReviewPageQueries} from "@/components/queries";
import {router} from "expo-router";


export default function Review() {
   const queries = useReviewPageQueries()

   const qReviewable = useQuery({
      queryKey: ["spatialite", "user_changes"],
      queryFn: () => queries.current.queryChanges()
   })

   console.log(qReviewable.error, qReviewable.status, qReviewable.fetchStatus)

   const result = qReviewable.isSuccess
   ? qReviewable.data.map(change => {
      const date = new Date(0)
      date.setUTCSeconds(change.modified_date || change.created_date)
      const formattedDate = date.toLocaleDateString()
      const params = {id: JSON.stringify(change.id)}
      const href = `/(tabs)?${new URLSearchParams(params).toString()}` as const
         const onPress = () => router.navigate(href)
      return <ListItem onPress={onPress} key={change.id}>
            <ListItem.Content>
               <ListItem.Title>{change.type === "addStopSign" ? "Add Stop Sign" : change.type}</ListItem.Title>
               <ListItem.Subtitle>{formattedDate}</ListItem.Subtitle>
            </ListItem.Content>
         </ListItem>
   })
      : <Text>Loading. Or an Error.</Text>

   return <View>{result}</View>
}