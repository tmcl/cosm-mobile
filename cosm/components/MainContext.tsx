import {createContext} from 'react'

export type MapArea =[number, number]|"unknown"|"unloaded" 

export type AppState = {
    mapArea: MapArea,
    setMapArea: (mapArea: MapArea) => void
}

export const appState: AppState = {
    mapArea: "unloaded",
    setMapArea: () => {}
}

export const MainContext = createContext(appState)