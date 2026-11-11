/**
 * CONTEXTO DE GEOLOCALIZAÇÃO.
 * - requestLocation: uma leitura do GPS (navigator.geolocation.getCurrentPosition).
 * - startTracking/stopTracking: acompanhamento contínuo (watchPosition), sempre encerrado
 *   ao desmontar para não drenar bateria.
 * - chooseNeighborhood: alternativa aproximada sem GPS (bairros de São Luís).
 * Privacidade: a posição fica só na memória da aba; nunca vai para o localStorage.
 * O GPS exige contexto seguro (HTTPS ou localhost); fora disso o erro é explicado ao usuário.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type UserLocation = {
  label: string;
  latitude: number;
  longitude: number;
  source: 'gps' | 'manual';
  accuracyMeters?: number;
  updatedAt?: number;
};
type Status = 'idle' | 'loading' | 'ready' | 'error';

// Alternativa deliberadamente aproximada para quem não quer disponibilizar GPS.
export const neighborhoods = [
  { id:'centro', label:'Centro (aproximado)', latitude:-2.5299, longitude:-44.3020 },
  { id:'renascenca', label:'Renascença (aproximado)', latitude:-2.4946, longitude:-44.2886 },
  { id:'cohama', label:'Cohama (aproximado)', latitude:-2.5282, longitude:-44.2575 },
  { id:'angelim', label:'Angelim (aproximado)', latitude:-2.5529, longitude:-44.2465 },
] as const;

type LocationState = {
  location: UserLocation | null;
  status: Status;
  error: string | null;
  isWatching: boolean;
  requestLocation: () => void;
  startTracking: () => void;
  stopTracking: () => void;
  chooseNeighborhood: (id: string) => void;
  clearLocation: () => void;
};
const Context = createContext<LocationState | null>(null);

/** Traduz os códigos da API de geolocalização (1 negado, 2 indisponível, 3 tempo esgotado). */
function geolocationError(error: GeolocationPositionError) {
  const messages: Record<number,string> = {
    1:'Você não autorizou a localização. Confira as permissões do navegador ou escolha um bairro.',
    2:'O dispositivo não conseguiu determinar sua posição. Ative a localização no sistema e tente novamente.',
    3:'A localização demorou mais que o esperado. Tente de novo ou escolha um bairro.'
  };
  return messages[error.code] || 'Falha ao obter a localização.';
}
function isAvailable() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator && window.isSecureContext;
}

/**
 * Provedor da localização. `requestId` descarta respostas antigas do GPS quando o usuário
 * pede de novo antes da primeira terminar (evita condição de corrida).
 */
export function LocationProvider({ children }: {children: ReactNode}) {
  // A posição do usuário existe somente nesta aba. Nunca fica no localStorage.
  const [location,setLocation] = useState<UserLocation|null>(null);
  const [status,setStatus] = useState<Status>('idle');
  const [error,setError] = useState<string|null>(null);
  const [isWatching,setIsWatching] = useState(false);
  const watcher = useRef<number|null>(null);
  const locationRef = useRef<UserLocation|null>(null);
  const requestId = useRef(0);

  const stopTracking = useCallback(() => {
    if(watcher.current !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watcher.current);
      watcher.current = null;
    }
    setIsWatching(false);
  }, []);

  const receive = useCallback((position:GeolocationPosition, watching:boolean) => {
    const current: UserLocation = {
      label: watching?'Localização ao vivo':'Sua localização atual',
      latitude:position.coords.latitude,
      longitude:position.coords.longitude,
      accuracyMeters:Math.round(position.coords.accuracy),
      updatedAt:position.timestamp,
      source:'gps',
    };
    // Evita requisições repetidas quando o navegador só relata pequenas flutuações de GPS.
    const previous = locationRef.current;
    if (watching && previous?.source === 'gps') {
      const degrees = Math.hypot(current.latitude-previous.latitude,current.longitude-previous.longitude);
      if (degrees < 0.00015 && Date.now()-(previous.updatedAt ?? 0)<30_000) return;
    }
    locationRef.current=current;
    setLocation(current);
    setStatus('ready');setError(null);
  },[]);

  const requestLocation = useCallback(() => {
    stopTracking();
    const currentRequest=++requestId.current;
    if(!isAvailable()) {
      setStatus('error');setError('Localização exige HTTPS ou localhost e um navegador com suporte a geolocalização.');
      return;
    }
    setStatus('loading');setError(null);
    navigator.geolocation.getCurrentPosition(
      (position)=>{if(requestId.current===currentRequest)receive(position,false);},
      (err)=>{if(requestId.current===currentRequest){setStatus('error');setError(geolocationError(err));}},
      { enableHighAccuracy:true, maximumAge:15_000, timeout:20_000 }
    );
  },[receive,stopTracking]);

  const startTracking = useCallback(() => {
    stopTracking();
    const currentRequest=++requestId.current;
    if(!isAvailable()) {
      setStatus('error');setError('Acompanhamento indisponível. Use HTTPS ou localhost e autorize sua localização.');
      return;
    }
    setStatus('loading');setError(null);
    watcher.current=navigator.geolocation.watchPosition(
      (position)=>{if(requestId.current===currentRequest)receive(position,true);},
      (err)=>{
        if(requestId.current!==currentRequest)return;
        setStatus('error');setError(geolocationError(err));
        // Não mantenha monitoramento em caso de permissão revogada.
        if(err.code===1)stopTracking();
      },
      {enableHighAccuracy:true,maximumAge:10_000,timeout:20_000}
    );
    setIsWatching(true);
  },[receive,stopTracking]);

  const chooseNeighborhood = useCallback((id:string) => {
    const point=neighborhoods.find(n=>n.id===id);
    if(!point)return;
    ++requestId.current;stopTracking();
    const selected={label:point.label,latitude:point.latitude,longitude:point.longitude,source:'manual' as const};
    locationRef.current=selected;setLocation(selected);setStatus('ready');setError(null);
  },[stopTracking]);

  const clearLocation = useCallback(()=>{
    ++requestId.current;stopTracking();locationRef.current=null;
    setLocation(null);setStatus('idle');setError(null);
  },[stopTracking]);

  useEffect(()=>()=>{
    ++requestId.current;
    if(watcher.current!==null && 'geolocation' in navigator)navigator.geolocation.clearWatch(watcher.current);
  },[]);

  const value=useMemo(()=>({location,status,error,isWatching,requestLocation,startTracking,stopTracking,chooseNeighborhood,clearLocation}),
    [location,status,error,isWatching,requestLocation,startTracking,stopTracking,chooseNeighborhood,clearLocation]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Hook de acesso à localização atual, ao status ('idle' | 'loading' | 'ready' | 'error') e às ações. */
export function useUserLocation() {
  const state=useContext(Context);
  if(!state)throw new Error('useUserLocation deve ser usado dentro de LocationProvider');
  return state;
}
