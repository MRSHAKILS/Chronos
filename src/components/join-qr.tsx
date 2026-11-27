'use client'

import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** QR code linking to the customer screen on this same deployment. */
export function JoinQr({ size = 168 }: { size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  const [url, setUrl] = useState('')

  useEffect(() => {
    const target = `${window.location.origin}/customer`
    QRCode.toDataURL(target, { margin: 0, width: size * 2, color: { dark: '#141414', light: '#F4F3ED' } }).then((data) => {
      setUrl(target)
      setSrc(data)
    })
  }, [size])

  return (
    <div className="flex items-center gap-4 border border-obsidian p-3">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} width={size} height={size} alt={`QR code to join the queue at ${url}`} />
      ) : (
        <div style={{ width: size, height: size }} />
      )}
      <div className="max-w-[160px]">
        <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-obsidian/60">Scan to join</p>
        <p className="mt-1 font-display text-xl leading-tight font-medium">Join the queue from your phone</p>
        <p className="mt-2 font-mono text-[10px] break-all text-obsidian/60">{url.replace(/^https?:\/\//, '')}</p>
      </div>
    </div>
  )
}
