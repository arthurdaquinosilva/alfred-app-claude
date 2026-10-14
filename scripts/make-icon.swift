// Draws the workflow icon: a warm gradient rounded square with a white
// twelve-ray burst (prisms radiating from a central sphere).
// Usage: swift scripts/make-icon.swift <output.png>
import AppKit

let size: CGFloat = 512
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

// Background
let inset: CGFloat = 24
let bg = CGPath(roundedRect: CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2),
                cornerWidth: 112, cornerHeight: 112, transform: nil)
ctx.addPath(bg)
ctx.clip()
let colors = [NSColor(srgbRed: 0.93, green: 0.55, blue: 0.40, alpha: 1).cgColor,
              NSColor(srgbRed: 0.76, green: 0.33, blue: 0.22, alpha: 1).cgColor] as CFArray
let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: size), end: CGPoint(x: size, y: 0), options: [])

// Burst
let center = CGPoint(x: size / 2, y: size / 2)
ctx.setFillColor(NSColor.white.cgColor)
for i in 0..<12 {
  let angle = CGFloat(i) * .pi / 6
  let long = i % 2 == 0
  let length: CGFloat = long ? 170 : 128
  let half: CGFloat = long ? 17 : 14
  ctx.saveGState()
  ctx.translateBy(x: center.x, y: center.y)
  ctx.rotate(by: angle)
  let ray = CGMutablePath()
  ray.move(to: CGPoint(x: 0, y: -half))
  ray.addLine(to: CGPoint(x: length - half, y: -half * 0.55))
  ray.addArc(center: CGPoint(x: length - half, y: 0), radius: half * 0.55, startAngle: -.pi / 2, endAngle: .pi / 2, clockwise: false)
  ray.addLine(to: CGPoint(x: 0, y: half))
  ray.closeSubpath()
  ctx.addPath(ray)
  ctx.fillPath()
  ctx.restoreGState()
}
ctx.fillEllipse(in: CGRect(x: center.x - 44, y: center.y - 44, width: 88, height: 88))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
