import {ScrollView, View} from "react-native"
import {Text, ListItem, SpeedDial} from "@rneui/themed"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {useReviewPageQueries} from "@/components/queries";
import {router} from "expo-router";
import {useState} from "react"


export default function Review() {
   const queries = useReviewPageQueries()
   const queryClient = useQueryClient()
   const [checked, setChecked] = useState<{[ix: number]: boolean}>({})
  const toggle = (ix: number) => setChecked({...checked, [ix]: !checked[ix]})
   const qReviewable = useQuery({
      queryKey: ["spatialite", "needed for loading"],
      queryFn: () => queries.current.queryChanges()
   })
  const [speedDialOpen, setSpeedDialOpen] = useState (false)

  const onSubmit= async () => {
    const checkedIds = Object.entries(checked)
    .filter(([_id, isChecked]) => isChecked)
    .map(([id]) => Number(id));
    if(checkedIds.length === 0) return;

    const checkedId = checkedIds[0]
    // const changesetId = +( await putApi06ChangesetCreateText({changeset: {created_by: user_agent}}) )

    const change = await queries.current.selectUserChange(checkedId)
    console.log("i want to somehow save this change", change)

    //const diff: OsmChange = {
    //  version: "0.6",
    //  generator: user_agent,
    //  create, modify, delete: delete_
    //}
  }

  const onDelete = async () => {
    const checkedIds = Object.entries(checked)
      .filter(([_id, isChecked]) => isChecked)
      .map(([id]) => Number(id));
    console.log("i will delete", checkedIds)
    try {
      const v = await queries.current.deleteChanges({ids: checkedIds})
      console.log("i deleted", v)
      Promise.all([
        queryClient.invalidateQueries({queryKey: ["spatialite", "needed for loading"]}),
        queryClient.invalidateQueries({queryKey: ["needed for loading"]})])
      setSpeedDialOpen(false)
    } catch (e) {
      console.log("i unsuccessfully deleted", e)
    }
  }

   console.log(qReviewable.error, qReviewable.status, qReviewable.fetchStatus)

   const result = qReviewable.isSuccess
      ? (qReviewable.data).map(change => {
         const date = new Date(0)
         date.setUTCSeconds(change.modified_date || change.created_date)
         const formattedDate = date.toLocaleDateString()
         const params = {id: JSON.stringify(change.id)}
         const href = `/(tabs)?${new URLSearchParams(params).toString()}` as const
         const onPress = () => router.navigate(href)
         console.log(`each change.id ${change.id}`)
         return <ListItem onPress={onPress} key={change.id}>
           <ListItem.Title>{change.commentary1 || (change.type === "addStopSign" ? "*Add Stop Sign" : change.type)}</ListItem.Title>
           <ListItem.Subtitle>{change.commentary2 ? `${change.commentary2} at ${formattedDate}` : formattedDate}</ListItem.Subtitle>
           <ListItem.CheckBox
               key={1}
               checked={checked[change.id]}
               onPress={() => toggle(change.id)}
           />
         </ListItem>
      })
      : <Text key={"nothing"}>Loading. Or an Error.</Text>


   return <View style={{flex: 1}}>
     <ScrollView>{result}</ScrollView>
     <SpeedDial
         isOpen={speedDialOpen}
         onOpen={() => setSpeedDialOpen(true)}
         onClose={() => setSpeedDialOpen(false)}
     >
       <SpeedDial.Action
           icon={{ name: 'add', color: '#fff' }}
           title="Submit"
           onPress={onSubmit}
       />
       <SpeedDial.Action
      icon={{ name: 'delete', color: '#fff' }}
      title="Delete"
      onPress={onDelete}
    />
     </SpeedDial>
   </View>
}
