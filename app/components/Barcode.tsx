import { useEffect, useRef } from 'react';

interface BarcodeProps {
    value: string;
    format?: string;
    height?: number;
}

export default function Barcode({ value, format = 'CODE128', height = 60 }: BarcodeProps) {
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        // JsBarcode is loaded via CDN in root.tsx
        if (svgRef.current && typeof (window as any).JsBarcode !== 'undefined') {
            try {
                (window as any).JsBarcode(svgRef.current, value, {
                    format,
                    height,
                    displayValue: true,
                    fontSize: 14,
                    margin: 10,
                    background: '#ffffff',
                });
            } catch (e) {
                console.error('Barcode generation failed:', e);
            }
        }
    }, [value, format, height]);

    return (
        <div className="barcode-container" style={{ textAlign: 'center' }}>
            <svg ref={svgRef}></svg>
        </div>
    );
}
