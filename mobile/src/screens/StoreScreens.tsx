import React, { useRef, useState } from 'react';
import { Alert, Text, View, useWindowDimensions } from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Badge, Body, Card, Chip, Empty, Icon, IconName, LinkCard, Page, Resource, Title, ui, useResource } from '../components/UI';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useApp } from '../providers/AppProvider';
import { checkout, getOrders, getProducts, money, quote } from '../services/api';
import { Routes } from '../navigation/types';
import { colors } from '../theme';
import { Order } from '../types';
import { friendlyError } from '../services/errors';

export function StoreScreen({ navigation }: { navigation: Pick<NativeStackNavigationProp<Routes>, 'navigate'> }) {
  const { online, cart, session } = useApp(); const { width } = useWindowDimensions();
  const resource = useResource(() => getProducts(online), [online]);
  return <Page onRefresh={resource.reload} refreshing={resource.loading}>
    <Button title={`Your cart · ${cart.reduce((total, item) => total + item.quantity, 0)} items`} onPress={() => navigation.navigate('Cart')} />
    {resource.data?.some(product => product.cached) && <Badge label="Offline - cached" icon="cloud-offline-outline" />}
    <Resource resource={resource}>{!resource.data?.length && <Empty message="New club gear is on its way. Check back soon." />}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{resource.data?.map(product => <View key={product.id} style={{ width: width >= 390 ? '48%' : '100%' }}>
        <LinkCard label={`View ${product.name}, ${money(product.price)}`} onPress={() => navigation.navigate('ProductDetail', { id: product.id })}>
          <View style={{ backgroundColor: colors.sand, minHeight: 110, borderRadius: 16, justifyContent: 'center', alignItems: 'center' }}><Icon name={product.symbol as IconName} size={54} /></View>
          <Body strong>{product.name}</Body><Body>{money(product.price)}</Body>
        </LinkCard></View>)}</View>
    </Resource></Page>;
}
export function ProductDetailScreen({ route, navigation }: NativeStackScreenProps<Routes, 'ProductDetail'>) {
  const { online, cart, setCart, notify, session } = useApp(); const [size, setSize] = useState(''); const [color, setColor] = useState(''); const [busy, setBusy] = useState(false);
  const resource = useResource(() => getProducts(online), [online]); const product = resource.data?.find(item => item.id === route.params.id);
  const chosenSize = size || product?.sizes[0] || ''; const chosenColor = color || product?.colors[0] || '';
  const variant = product?.variants?.find(item => item.size === chosenSize && item.color === chosenColor);
  async function add() {
    if (!product) return; setBusy(true);
    try {
      if (!variant || product.cached || !online) throw new Error('Reconnect and refresh this product to choose an available variant.');
      if (variant.stock - variant.reserved <= 0) throw new Error('This variant is out of stock. Choose another size or color.');
      const index = cart.findIndex(item => item.variantId === variant.id);
      if (index >= 0 && cart[index].quantity >= 10) throw new Error('You can add up to 10 of this variant.');
      const priced = { ...product, price: variant.price };
      const next = index >= 0 ? cart.map((item, i) => i === index ? { ...item, product: priced, quantity: item.quantity + 1 } : item) : [...cart, { product: priced, variantId: variant.id, size: chosenSize, color: chosenColor, quantity: 1 }];
      await setCart(next); notify('Added to your cart.');
    } catch (e) { Alert.alert('Could not add item', friendlyError(e, 'Could not save this item. Please try again.')); }
    finally { setBusy(false); }
  }
  return <Page onRefresh={resource.reload} refreshing={resource.loading}><Resource resource={resource}>{product ? <>
    <Card><View style={{ backgroundColor: colors.sand, borderRadius: 16, minHeight: 180, alignItems: 'center', justifyContent: 'center' }}><Icon name={product.symbol as IconName} size={96} /></View>
      <Title>{product.name}</Title><Body strong>{money(variant?.price ?? product.price)}</Body><Body>{product.description}</Body>{product.cached && <Badge label="Offline - cached" icon="cloud-offline-outline" />}</Card>
    <Body strong>Size</Body><View style={ui.row}>{product.sizes.map(value => <Chip key={value} label={value} active={chosenSize === value} onPress={() => setSize(value)} />)}</View>
    <Body strong>Color</Body><View style={ui.row}>{product.colors.map(value => <Chip key={value} label={value} active={chosenColor === value} onPress={() => setColor(value)} />)}</View>
    <Body>{variant ? `${Math.max(0, variant.stock - variant.reserved)} available` : 'This size/color combination is unavailable.'}</Body>
    <Button title="Add to cart" onPress={add} busy={busy} disabled={!online || !!product.cached || !variant || variant.stock - variant.reserved <= 0} /><Button title="View cart" onPress={() => navigation.navigate('Cart')} />
    {(!online || product.cached) && <><Body>Reconnect and refresh to add this product.</Body><Button title="Refresh product" onPress={resource.reload} /></>}
  </> : <><Empty message="This product is no longer available." /><Button title="Browse store" onPress={() => navigation.popTo('Home', { screen: 'Store' })} /></>}</Resource></Page>;
}
function Totals({ totals }: { totals: ReturnType<typeof quote> }) {
  return <Card>{[['Subtotal', totals.subtotal], ['Discount', -totals.discount], ['Delivery', totals.shipping], ['Total', totals.total]].map(([label, value]) => <View key={String(label)} style={[ui.row, { justifyContent: 'space-between' }]}><Body strong={label === 'Total'}>{String(label)}</Body><Body strong={label === 'Total'}>{money(Number(value))}</Body></View>)}</Card>;
}
export function CartScreen({ navigation }: NativeStackScreenProps<Routes, 'Cart'>) {
  const { cart, setCart, session } = useApp(); const [busy, setBusy] = useState(false);
  async function change(index: number, delta: number) {
    setBusy(true);
    try { await setCart(cart.map((item, i) => i === index ? { ...item, quantity: Math.min(10, item.quantity + delta) } : item).filter(item => item.quantity > 0)); }
    catch { Alert.alert('Cart not saved', 'Could not update your cart. Please try again.'); } finally { setBusy(false); }
  }
  return <Page><Title>Your match-day bag.</Title>{!cart.length ? <><Empty message="Your cart is empty. Find your club colours in the Store." /><Button title="Browse store" onPress={() => navigation.popTo('Home', { screen: 'Store' })} /></> : <>
    {cart.map((item, index) => <Card key={`${item.product.id}:${item.size}:${item.color}`}><Body strong>{item.product.name}</Body><Body>{item.size} · {item.color} · {money(item.product.price)}</Body>
      <View style={ui.row}><Button title="−" accessibilityLabel={`Decrease quantity of ${item.product.name}${item.quantity === 1 ? ', removes this item' : ''}`} busy={busy} onPress={() => { if (item.quantity === 1) Alert.alert('Remove item?', `Remove ${item.product.name} from your cart?`, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', onPress: () => void change(index, -1) }]); else void change(index, -1); }} /><Text accessibilityLiveRegion="polite" accessibilityLabel={`Quantity ${item.quantity}`} style={[ui.body, { minWidth: 32, textAlign: 'center' }]}>{item.quantity}</Text><Button title="+" accessibilityLabel={`Increase quantity of ${item.product.name}`} busy={busy} disabled={item.quantity >= 10} onPress={() => void change(index, 1)} /></View>
    </Card>)}<Totals totals={quote(cart, '')} /><Button title="Continue to checkout" onPress={() => navigation.navigate('Checkout')} />
  </>}</Page>;
}
export function CheckoutScreen({ navigation }: NativeStackScreenProps<Routes, 'Checkout'>) {
  const { cart, online, session, setCart, notify } = useApp(); const [code, setCode] = useState(''); const [applied, setApplied] = useState('');
  const [payment, setPayment] = useState<'success' | 'declined' | 'capture_fail'>('success'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const confirming = useRef(false);
  function confirmCheckout() {
    if (lock.current || confirming.current) return;
    if (!online) { setError('Reconnect to complete your purchase. Your cart is saved.'); return; }
    confirming.current = true;
    Alert.alert('Place this order?', `${cart.reduce((total, item) => total + item.quantity, 0)} item(s) · estimated ${money(quote(cart, applied).total)}. This submits your order using the selected test payment option.`, [
      { text: 'Keep reviewing', style: 'cancel', onPress: () => { confirming.current = false; } },
      { text: 'Confirm order', onPress: () => { confirming.current = false; void pay(); } },
    ], { cancelable: true, onDismiss: () => { confirming.current = false; } });
  }
  async function pay() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const order = await checkout(cart, applied, payment, online, session.email);
      if (order.status === 'Paid') {
        try { await setCart([]); } catch { notify('Payment saved. Your cart could not be cleared; review it before purchasing again.'); }
      }
      navigation.replace('PaymentResult', { id: order.id });
    } catch (e) { setError(friendlyError(e, 'Could not complete checkout. Please try again.')); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Page><Title>One step from match day.</Title><Badge label="Test payment · no real charge" icon="card-outline" />
    {!online && <Badge label="Offline · reconnect to pay" icon="cloud-offline-outline" />}
    {!cart.length ? <><Empty message="Your cart is empty. Add a product in the Store first." /><Button title="Browse store" onPress={() => navigation.popTo('Home', { screen: 'Store' })} /></> : <>
      <Body strong>Discount code</Body><Input accessibilityLabel="Discount code" editable={!busy} value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="WELCOME10" />
      <Button title="Apply code" disabled={busy} onPress={() => { try { quote(cart, code); setApplied(code.trim().toUpperCase()); setError(''); notify(code.trim() ? 'Discount applied.' : 'Discount removed.'); } catch (e) { setError(friendlyError(e)); } }} />
      {applied !== '' && <Body>Applied: {applied}</Body>}<Body>Estimated totals. Your receipt shows the server’s final amounts.</Body><Totals totals={quote(cart, applied)} />
      <Body strong>Test payment outcome</Body><View style={ui.row}>{(['success', 'declined', 'capture_fail'] as const).map(value => <Chip key={value} label={value === 'capture_fail' ? 'Capture fail' : value === 'success' ? 'Success' : 'Declined'} active={payment === value} disabled={busy} onPress={() => setPayment(value)} />)}</View>
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={ui.body}>{error}</Text>}
      {busy && <Text accessibilityLiveRegion="polite" style={ui.body}>Completing your order. Please wait…</Text>}
      <Button title={`Pay ${money(quote(cart, applied).total)}`} onPress={confirmCheckout} busy={busy} disabled={!online} />
    </>}</Page>;
}
export function PaymentResultScreen({ route, navigation }: NativeStackScreenProps<Routes, 'PaymentResult'>) {
  const { session } = useApp(); const resource = useResource(() => getOrders(session.email), [route.params.id]);
  const order = resource.data?.find(item => item.id === route.params.id);
  return <Page><Resource resource={resource}>{order ? <Card>
    <Badge label={order.status} icon={order.status === 'Paid' ? 'checkmark-circle-outline' : 'alert-circle-outline'} />
    <Title>{order.status === 'Paid' ? 'You’re all set.' : 'Payment didn’t go through.'}</Title>
    <Body>{order.status === 'Paid' ? 'Your order is confirmed. Your server receipt is ready.' : 'Payment was not completed. Your cart is saved.'}</Body>
    <Body>{money(order.total)}</Body>
    {order.status === 'Paid' ? <Button title="View receipt" onPress={() => navigation.navigate('Receipt', { id: order.id })} /> : <Button title="Try checkout again" onPress={() => navigation.replace('Checkout')} />}
  </Card> : <Empty message="This order could not be found." />}</Resource><Button title="Continue shopping" onPress={() => navigation.popTo('Home', { screen: 'Store' })} /></Page>;
}
export function ReceiptScreen({ route, navigation }: NativeStackScreenProps<Routes, 'Receipt'>) {
  const { session, notify } = useApp(); const [busy, setBusy] = useState(false);
  const resource = useResource(() => getOrders(session.email), [route.params.id]); const order = resource.data?.find(item => item.id === route.params.id);
  async function download(receipt: Order) {
    setBusy(true);
    try {
      if (!receipt.pdfBase64) throw new Error('The server receipt PDF is unavailable. Retry checkout to retrieve the same order.');
      const file = new File(Paths.document, `receipt-${receipt.id.replace(/[^A-Za-z0-9_.-]/g, '_')}.pdf`);
      await file.write(receipt.pdfBase64, { encoding: 'base64' });
      if (!(await Sharing.isAvailableAsync())) throw new Error('PDF created, but sharing is unavailable on this device.');
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Save or share your Skorly receipt', UTI: 'com.adobe.pdf' });
      notify('Receipt PDF is ready to save or share.');
    } catch (e) { Alert.alert('Could not export receipt', friendlyError(e, 'Could not save or share the PDF. Please try again.')); }
    finally { setBusy(false); }
  }
  return <Page><Resource resource={resource}>{order?.status === 'Paid' ? <>
    <Title>Your receipt.</Title><Badge label="Paid" icon="receipt-outline" /><Body>Order {order.id}</Body><Body>{new Date(order.createdAt).toLocaleString()}</Body>
    {order.items.map((item, index) => <Card key={index}><Body strong>{item.product.name}</Body><Body>{item.size} · {item.color} × {item.quantity}</Body><Body>{money(item.product.price * item.quantity)}</Body></Card>)}
    <Totals totals={order} /><Button title="Download PDF" onPress={() => void download(order)} busy={busy} /><Body>Choose a save or share destination in the Android share sheet.</Body>
  </> : <Empty message="A paid order is needed to view a receipt." />}</Resource><Button title="Continue shopping" onPress={() => navigation.popTo('Home', { screen: 'Store' })} /></Page>;
}


