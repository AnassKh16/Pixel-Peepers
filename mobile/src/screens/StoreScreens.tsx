import React, { useRef, useState } from 'react';
import { Alert, Text, View, useWindowDimensions } from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Badge, Body, Card, Chip, Empty, Icon, IconName, LinkCard, Page, Resource, Title, ui, useResource } from '../components/UI';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useApp } from '../providers/AppProvider';
import { checkout, getOrders, getProducts, money, quote } from '../services/api';
import { Routes } from '../navigation/types';
import { colors } from '../theme';
import { Order } from '../types';

export function StoreScreen({ navigation }: { navigation: Pick<NativeStackNavigationProp<Routes>, 'navigate'> }) {
  const { online, cart } = useApp(); const { width } = useWindowDimensions();
  const resource = useResource(() => getProducts(online), [online]);
  return <Page><Title>For the love of the club.</Title><Body>Good gear. Great company. All prices in PKR.</Body>
    <Button title={`Your cart · ${cart.reduce((total, item) => total + item.quantity, 0)} items`} onPress={() => navigation.navigate('Cart')} />
    <Resource resource={resource}>{!resource.data?.length && <Empty message="New club gear is on its way. Check back soon." />}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{resource.data?.map(product => <View key={product.id} style={{ width: width >= 390 ? '48%' : '100%' }}>
        <LinkCard label={`View ${product.name}, ${money(product.price)}`} onPress={() => navigation.navigate('ProductDetail', { id: product.id })}>
          <View style={{ backgroundColor: colors.sand, minHeight: 110, borderRadius: 16, justifyContent: 'center', alignItems: 'center' }}><Icon name={product.symbol as IconName} size={54} /></View>
          <Body strong>{product.name}</Body><Body>{money(product.price)}</Body>
        </LinkCard></View>)}</View>
    </Resource></Page>;
}
export function ProductDetailScreen({ route, navigation }: NativeStackScreenProps<Routes, 'ProductDetail'>) {
  const { online, cart, setCart, notify } = useApp(); const [size, setSize] = useState(''); const [color, setColor] = useState(''); const [busy, setBusy] = useState(false);
  const resource = useResource(() => getProducts(online), [online]); const product = resource.data?.find(item => item.id === route.params.id);
  const chosenSize = size || product?.sizes[0] || ''; const chosenColor = color || product?.colors[0] || '';
  async function add() {
    if (!product) return; setBusy(true);
    try {
      const index = cart.findIndex(item => item.product.id === product.id && item.size === chosenSize && item.color === chosenColor);
      if (index >= 0 && cart[index].quantity >= 10) throw new Error('You can add up to 10 of this variant.');
      const next = index >= 0 ? cart.map((item, i) => i === index ? { ...item, quantity: item.quantity + 1 } : item) : [...cart, { product, size: chosenSize, color: chosenColor, quantity: 1 }];
      await setCart(next); notify('Added to your cart.');
    } catch (e) { Alert.alert('Could not add item', e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <Page><Resource resource={resource}>{product ? <>
    <Card><View style={{ backgroundColor: colors.sand, borderRadius: 16, minHeight: 180, alignItems: 'center', justifyContent: 'center' }}><Icon name={product.symbol as IconName} size={96} /></View>
      <Title>{product.name}</Title><Body strong>{money(product.price)}</Body><Body>{product.description}</Body></Card>
    <Body strong>Size</Body><View style={ui.row}>{product.sizes.map(value => <Chip key={value} label={value} active={chosenSize === value} onPress={() => setSize(value)} />)}</View>
    <Body strong>Color</Body><View style={ui.row}>{product.colors.map(value => <Chip key={value} label={value} active={chosenColor === value} onPress={() => setColor(value)} />)}</View>
    <Button title="Add to cart" onPress={add} busy={busy} /><Button title="View cart" onPress={() => navigation.navigate('Cart')} />
  </> : <Empty message="This product is no longer available." />}</Resource></Page>;
}
function Totals({ totals }: { totals: ReturnType<typeof quote> }) {
  return <Card>{[['Subtotal', totals.subtotal], ['Discount', -totals.discount], ['Delivery', totals.shipping], ['Total', totals.total]].map(([label, value]) => <View key={String(label)} style={[ui.row, { justifyContent: 'space-between' }]}><Body strong={label === 'Total'}>{String(label)}</Body><Body strong={label === 'Total'}>{money(Number(value))}</Body></View>)}</Card>;
}
export function CartScreen({ navigation }: NativeStackScreenProps<Routes, 'Cart'>) {
  const { cart, setCart } = useApp(); const [busy, setBusy] = useState(false);
  async function change(index: number, delta: number) {
    setBusy(true);
    try { await setCart(cart.map((item, i) => i === index ? { ...item, quantity: Math.min(10, item.quantity + delta) } : item).filter(item => item.quantity > 0)); }
    catch { Alert.alert('Cart not saved', 'Could not update your cart. Please try again.'); } finally { setBusy(false); }
  }
  return <Page><Title>Your match-day bag.</Title>{!cart.length ? <Empty message="Your cart is empty. Find your club colours in the Store." /> : <>
    {cart.map((item, index) => <Card key={`${item.product.id}:${item.size}:${item.color}`}><Body strong>{item.product.name}</Body><Body>{item.size} · {item.color} · {money(item.product.price)}</Body>
      <View style={ui.row}><Button title={`− ${item.quantity === 1 ? 'Remove' : 'Less'}`} busy={busy} onPress={() => { if (item.quantity === 1) Alert.alert('Remove item?', `Remove ${item.product.name} from your cart?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', onPress: () => void change(index, -1) }]); else void change(index, -1); }} /><Text accessibilityLabel={`Quantity ${item.quantity}`} style={ui.body}>{item.quantity}</Text><Button title="+ More" busy={busy || item.quantity >= 10} onPress={() => void change(index, 1)} /></View>
    </Card>)}<Totals totals={quote(cart, '')} /><Button title="Continue to checkout" onPress={() => navigation.navigate('Checkout')} />
  </>}</Page>;
}
export function CheckoutScreen({ navigation }: NativeStackScreenProps<Routes, 'Checkout'>) {
  const { cart, online, session, setCart, notify } = useApp(); const [code, setCode] = useState(''); const [applied, setApplied] = useState('');
  const [payment, setPayment] = useState<'success' | 'declined' | 'capture_fail'>('success'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false);
  async function pay() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const order = await checkout(cart, applied, payment, online, session.email);
      if (order.status === 'Paid') {
        try { await setCart([]); } catch { notify('Payment saved. Your cart could not be cleared; review it before purchasing again.'); }
      }
      navigation.replace('PaymentResult', { id: order.id });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete checkout. Please try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Page><Title>One step from match day.</Title><Badge label="Demo payment · no real charge" icon="card-outline" />
    {!online && <Badge label="Offline · reconnect to pay" icon="cloud-offline-outline" />}
    {!cart.length ? <Empty message="Your cart is empty. Add a product in the Store first." /> : <>
      <Body strong>Discount code</Body><Input accessibilityLabel="Discount code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="Try SKORLY10" />
      <Button title="Apply code" onPress={() => { try { quote(cart, code); setApplied(code.trim().toUpperCase()); setError(''); notify(code.trim() ? 'Discount applied.' : 'Discount removed.'); } catch (e) { setError((e as Error).message); } }} />
      {applied !== '' && <Body>Applied: {applied}</Body>}<Totals totals={quote(cart, applied)} />
      <Body strong>Mock payment token</Body><View style={ui.row}>{(['success', 'declined', 'capture_fail'] as const).map(value => <Chip key={value} label={value === 'capture_fail' ? 'Capture fail' : value === 'success' ? 'Success' : 'Declined'} active={payment === value} onPress={() => setPayment(value)} />)}</View>
      {!!error && <Text accessibilityRole="alert" style={ui.body}>{error}</Text>}
      <Button title={`Pay ${money(quote(cart, applied).total)}`} onPress={pay} busy={busy} />
    </>}</Page>;
}
export function PaymentResultScreen({ route, navigation }: NativeStackScreenProps<Routes, 'PaymentResult'>) {
  const { session } = useApp(); const resource = useResource(() => getOrders(session.email), [route.params.id]);
  const order = resource.data?.find(item => item.id === route.params.id);
  return <Page><Resource resource={resource}>{order ? <Card>
    <Badge label={order.status} icon={order.status === 'Paid' ? 'checkmark-circle-outline' : 'alert-circle-outline'} />
    <Title>{order.status === 'Paid' ? 'You’re all set.' : 'Payment didn’t go through.'}</Title>
    <Body>{order.status === 'Paid' ? 'Your demo order is confirmed. Your receipt is ready.' : order.status === 'Declined' ? 'The demo payment was declined. Your cart is saved. Choose another token and try again.' : 'The demo payment could not be captured. No payment was completed. Your cart is saved.'}</Body>
    <Body>{money(order.total)}</Body>
    {order.status === 'Paid' ? <Button title="View receipt" onPress={() => navigation.navigate('Receipt', { id: order.id })} /> : <Button title="Try checkout again" onPress={() => navigation.replace('Checkout')} />}
  </Card> : <Empty message="This order could not be found." />}</Resource></Page>;
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function ReceiptScreen({ route }: NativeStackScreenProps<Routes, 'Receipt'>) {
  const { session, notify } = useApp(); const [busy, setBusy] = useState(false);
  const resource = useResource(() => getOrders(session.email), [route.params.id]); const order = resource.data?.find(item => item.id === route.params.id);
  async function download(receipt: Order) {
    setBusy(true);
    try {
      const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;color:#16261F;padding:32px}h1{font-size:32px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #EFE6D3}.total{font-size:22px}</style></head><body><h1>Skorly · Receipt</h1><p>DEMO ORDER · NO REAL PAYMENT</p><p>Order ${escape(receipt.id)}<br>${escape(new Date(receipt.createdAt).toLocaleString())}</p><table><tr><th>Item / variant</th><th>Qty</th><th>Amount</th></tr>${receipt.items.map(item => `<tr><td>${escape(item.product.name)}<br>${escape(item.size)} / ${escape(item.color)}</td><td>${item.quantity}</td><td>${money(item.product.price * item.quantity)}</td></tr>`).join('')}</table><p>Subtotal ${money(receipt.subtotal)}<br>Discount −${money(receipt.discount)}<br>Delivery ${money(receipt.shipping)}</p><p class="total">Total paid: ${money(receipt.total)}</p></body></html>`;
      const file = await Print.printToFileAsync({ html });
      if (!(await Sharing.isAvailableAsync())) throw new Error('PDF created, but sharing is unavailable on this device.');
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Save or share your Skorly receipt', UTI: 'com.adobe.pdf' });
      notify('Receipt PDF is ready to save or share.');
    } catch (e) { Alert.alert('Could not export receipt', e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <Page><Resource resource={resource}>{order?.status === 'Paid' ? <>
    <Title>Your receipt.</Title><Badge label="Paid · demo order" icon="receipt-outline" /><Body>Order {order.id}</Body><Body>{new Date(order.createdAt).toLocaleString()}</Body>
    {order.items.map((item, index) => <Card key={index}><Body strong>{item.product.name}</Body><Body>{item.size} · {item.color} × {item.quantity}</Body><Body>{money(item.product.price * item.quantity)}</Body></Card>)}
    <Totals totals={order} /><Button title="Download PDF" onPress={() => void download(order)} busy={busy} /><Body>Choose a save or share destination in the Android share sheet.</Body>
  </> : <Empty message="A paid order is needed to view a receipt." />}</Resource></Page>;
}

