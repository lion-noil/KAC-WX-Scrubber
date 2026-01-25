import React, {useEffect, useRef} from "react";
import L from "leaflet";

export default function NcPreviewMap({center, bounds, dataUrl}) {
    const divRef = useRef(null);
    const mapRef = useRef(null);
    const overlayRef = useRef(null);
    const didFitRef = useRef(false);

    // 1) map은 mount 때 딱 1번만 생성
    useEffect(() => {
        if (!divRef.current) return;
        if (mapRef.current) return;

        const map = L.map(divRef.current, {
            center: center ? [center.lat, center.lon] : [33.4, 126.5],
            zoom: 8,

            zoomControl: false,
            attributionControl: false,

            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            touchZoom: false,

            zoomAnimation: false,
            fadeAnimation: false,
            markerZoomAnimation: false,
            inertia: false,
        });

        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
            subdomains: "abcd",
            maxZoom: 20,
        }).addTo(map);

        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
            overlayRef.current = null;
        };
    }, []); // ⭐ deps 비워야 함

    // 2) overlay는 setUrl로만 갱신 (remove/add 금지)
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        if (!bounds || !dataUrl) return;

        if (!overlayRef.current) {
            overlayRef.current = L.imageOverlay(dataUrl, bounds, {opacity: 0.9});
            overlayRef.current.addTo(map);

            // ✅ fitBounds는 “처음 1회만”
            if (!didFitRef.current) {
                map.fitBounds(bounds, {padding: [10, 10], animate: false});
                didFitRef.current = true;
            }
            return;
        }

        // ✅ 매 프레임: url만 바꾼다 (이게 핵심)
        overlayRef.current.setUrl(dataUrl);

        // bounds가 바뀌는 경우에만 업데이트 (대부분은 동일할 거임)
        overlayRef.current.setBounds(bounds);
    }, [bounds, dataUrl]);

    return <div ref={divRef} style={{width: "100%", height: "100%"}}/>;
}
