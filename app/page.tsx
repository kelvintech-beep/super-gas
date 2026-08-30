"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Shop = {
  id: number;
  name: string;
};

type Profile = {
  full_name: string | null;
  role: "admin" | "worker";
  shop_id: number | null;
};

type Product = {
  id: number;
  name: string;
  category: "refill" | "new";
  size: "6 KG" | "13 KG";
  brand: string | null;
  price: number;
};

type Stock = {
  shop_id: number;
  product_id: number;
  quantity: number;
};

type Sale = {
  shop_id: number;
  product_id?: number;
  quantity?: number;
  total_price: number;
};

export default function Home() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [activeShop, setActiveShop] = useState<number | null>(null);

  const [restockAmounts, setRestockAmounts] = useState<
    Record<number, string>
  >({});

  const [saleAmounts, setSaleAmounts] = useState<
    Record<number, string>
  >({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [selling, setSelling] = useState<number | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data: profileData, error: profileError } =
      await supabase
        .from("profiles")
        .select("full_name, role, shop_id")
        .eq("id", user.id)
        .single();

    if (profileError || !profileData) {
      console.error(profileError);
      await supabase.auth.signOut();
      router.push("/login");
      return;
    }

    const { data: shopsData } = await supabase
      .from("shops")
      .select("*")
      .order("id");

    const { data: productsData } = await supabase
      .from("products")
      .select("*")
      .order("category")
      .order("size");

    const { data: stockData } = await supabase
      .from("stock")
      .select("*");

    const { data: salesData } = await supabase
      .from("sales")
      .select("shop_id, product_id, quantity, total_price");

    setProfile(profileData);
    setShops(shopsData || []);
    setProducts(productsData || []);
    setStock(stockData || []);
    setSales(salesData || []);

    if (profileData.role === "worker") {
      setActiveShop(profileData.shop_id);
    } else {
      setActiveShop(shopsData?.[0]?.id || null);
    }

    setLoading(false);
  }

  async function restock(productId: number) {
    if (!activeShop) return;

    const amount = Number(restockAmounts[productId]);

    if (!amount || amount <= 0) {
      alert("Enter a valid quantity.");
      return;
    }

    setSaving(productId);

    const existing = stock.find(
      (item) =>
        item.shop_id === activeShop &&
        item.product_id === productId
    );

    if (existing) {
      const { error } = await supabase
        .from("stock")
        .update({
          quantity: existing.quantity + amount,
        })
        .eq("shop_id", activeShop)
        .eq("product_id", productId);

      if (error) {
        alert(error.message);
        setSaving(null);
        return;
      }
    } else {
      const { error } = await supabase.from("stock").insert({
        shop_id: activeShop,
        product_id: productId,
        quantity: amount,
      });

      if (error) {
        alert(error.message);
        setSaving(null);
        return;
      }
    }

    setRestockAmounts((prev) => ({
      ...prev,
      [productId]: "",
    }));

    await loadDashboard();
    setSaving(null);
  }

  async function sellProduct(product: Product) {
    if (!activeShop) return;

    const quantitySold = Number(saleAmounts[product.id]);

    if (!quantitySold || quantitySold <= 0) {
      alert("Enter a valid sale quantity.");
      return;
    }

    const currentStock = getProductStock(
      activeShop,
      product.id
    );

    if (quantitySold > currentStock) {
      alert(
        `Not enough stock. Available: ${currentStock}`
      );
      return;
    }

    setSelling(product.id);

    const newQuantity = currentStock - quantitySold;

    const { error: stockError } = await supabase
      .from("stock")
      .update({
        quantity: newQuantity,
      })
      .eq("shop_id", activeShop)
      .eq("product_id", product.id);

    if (stockError) {
      alert(stockError.message);
      setSelling(null);
      return;
    }

    const totalPrice =
      quantitySold * Number(product.price);

    const { error: saleError } = await supabase
      .from("sales")
      .insert({
        shop_id: activeShop,
        product_id: product.id,
        quantity: quantitySold,
        unit_price: product.price,
        total_price: totalPrice,
      });

    if (saleError) {
      alert(saleError.message);

      await supabase
        .from("stock")
        .update({
          quantity: currentStock,
        })
        .eq("shop_id", activeShop)
        .eq("product_id", product.id);

      setSelling(null);
      return;
    }

    setSaleAmounts((prev) => ({
      ...prev,
      [product.id]: "",
    }));

    await loadDashboard();
    setSelling(null);
  }

  async function updatePrice(
    productId: number,
    currentPrice: number
  ) {
    const input = document.getElementById(
      `price-${productId}`
    ) as HTMLInputElement;

    const newPrice = Number(input.value);

    if (
      newPrice < 0 ||
      Number.isNaN(newPrice) ||
      input.value === ""
    ) {
      alert("Enter a valid price.");
      return;
    }

    if (newPrice === currentPrice) {
      alert("The price has not changed.");
      return;
    }

    const { error } = await supabase
      .from("products")
      .update({ price: newPrice })
      .eq("id", productId);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Price updated successfully.");
    await loadDashboard();
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  function getShopStock(shopId: number) {
    return stock
      .filter((item) => item.shop_id === shopId)
      .reduce((sum, item) => sum + item.quantity, 0);
  }

  function getTotalStock() {
    return stock.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
  }

  function getShopSales(shopId: number) {
    return sales
      .filter((sale) => sale.shop_id === shopId)
      .reduce(
        (sum, sale) => sum + Number(sale.total_price),
        0
      );
  }

  function getTotalSales() {
    return sales.reduce(
      (sum, sale) => sum + Number(sale.total_price),
      0
    );
  }

  function getProductStock(
    shopId: number,
    productId: number
  ) {
    return (
      stock.find(
        (item) =>
          item.shop_id === shopId &&
          item.product_id === productId
      )?.quantity || 0
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <span className="text-white text-2xl font-black">
              SG
            </span>
          </div>

          <h1 className="text-3xl font-black tracking-widest text-white mt-5">
            SUPER GAS
          </h1>

          <p className="text-slate-400 mt-2">
            Loading dashboard...
          </p>
        </div>
      </main>
    );
  }

  const visibleShops =
    profile?.role === "admin"
      ? shops
      : shops.filter(
          (shop) => shop.id === profile?.shop_id
        );

  const activeShopData = shops.find(
    (shop) => shop.id === activeShop
  );

  const refills = products
  .filter((product) => product.category === "refill")
  .sort((a, b) => {
    const sizeA = parseInt(a.size);
    const sizeB = parseInt(b.size);
    return sizeA - sizeB;
  });

  const newCylinders = products.filter(
    (product) => product.category === "new"
  );

  const visibleSales =
    profile?.role === "admin"
      ? sales
      : sales.filter(
          (sale) => sale.shop_id === profile?.shop_id
        );

  function ProductCard({
    product,
  }: {
    product: Product;
  }) {
    const quantity = activeShop
      ? getProductStock(activeShop, product.id)
      : 0;

    const stockStatus =
      quantity === 0
        ? "bg-red-50 text-red-700 border-red-200"
        : quantity <= 2
        ? "bg-orange-50 text-orange-700 border-orange-200"
        : quantity <= 5
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-emerald-50 text-emerald-700 border-emerald-200";

    return (
      <div className="group bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 overflow-hidden">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="w-11 h-11 rounded-xl bg-slate-950 text-white flex items-center justify-center font-black mb-4">
                {product.category === "refill"
                  ? "G"
                  : "C"}
              </div>

              <h3 className="font-bold text-lg text-slate-900">
                {product.category === "refill"
                  ? product.size
                  : product.brand}
              </h3>

              <p className="text-sm text-slate-500 mt-1">
                {product.category === "refill"
                  ? "Gas Refill"
                  : product.size}
              </p>
            </div>

            <span
              className={`text-xs font-bold px-3 py-2 rounded-full border whitespace-nowrap ${stockStatus}`}
            >
              {quantity} in stock
            </span>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100">
            <p className="text-xs uppercase tracking-wider font-semibold text-slate-400">
              Selling Price
            </p>

            <p className="text-3xl font-black text-slate-950 mt-1">
              KSh {Number(product.price).toLocaleString()}
            </p>
          </div>

          {profile?.role === "admin" && (
            <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Admin Price Control
              </p>

              <input
                type="number"
                min="0"
                defaultValue={product.price}
                id={`price-${product.id}`}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500"
              />

              <button
                onClick={() =>
                  updatePrice(
                    product.id,
                    Number(product.price)
                  )
                }
                className="mt-2 w-full rounded-xl bg-slate-950 text-white py-2.5 font-bold hover:bg-slate-800 transition"
              >
                Update Price
              </button>
            </div>
          )}

          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Restock
            </p>

            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                placeholder="Quantity"
                value={
                  restockAmounts[product.id] || ""
                }
                onChange={(e) =>
                  setRestockAmounts((prev) => ({
                    ...prev,
                    [product.id]: e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:ring-2 focus:ring-slate-900"
              />

              <button
                onClick={() => restock(product.id)}
                disabled={saving === product.id}
                className="bg-slate-950 text-white px-4 rounded-xl font-bold disabled:opacity-50 hover:bg-slate-800 transition"
              >
                {saving === product.id
                  ? "..."
                  : "Add"}
              </button>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Record Sale
            </p>

            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                max={quantity}
                placeholder="Quantity"
                value={
                  saleAmounts[product.id] || ""
                }
                onChange={(e) =>
                  setSaleAmounts((prev) => ({
                    ...prev,
                    [product.id]: e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500"
              />

              <button
                onClick={() => sellProduct(product)}
                disabled={
                  selling === product.id ||
                  quantity === 0
                }
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 rounded-xl font-bold disabled:opacity-40 transition"
              >
                {selling === product.id
                  ? "..."
                  : "Sell"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200">
      {/* HEADER */}
      <header className="sticky top-0 z-40 bg-slate-950 text-white shadow-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg">
                <span className="font-black text-lg">
                  SG
                </span>
              </div>

              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-widest">
                  SUPER GAS
                </h1>

                <p className="text-slate-400 text-xs sm:text-sm">
                  Stock & Sales Management
                </p>
              </div>
            </div>

            <button
              onClick={logout}
              className="bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2.5 rounded-xl text-sm font-bold transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-7">
        {/* WELCOME */}
        <section className="mb-7">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <p className="text-emerald-600 font-bold text-sm uppercase tracking-wider">
                Dashboard
              </p>

              <h2 className="text-3xl sm:text-4xl font-black text-slate-950 mt-1">
                Welcome,{" "}
                {profile?.full_name || "User"}
              </h2>

              <p className="text-slate-500 mt-1 capitalize">
                {profile?.role} account
              </p>
            </div>

            {activeShopData && (
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
                <p className="text-xs uppercase tracking-wider font-bold text-slate-400">
                  Active Shop
                </p>
                <p className="font-black text-slate-900">
                  {activeShopData.name}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* SHOP SELECTOR */}
        {profile?.role === "admin" && (
          <section className="bg-white rounded-3xl shadow-sm border border-slate-200 p-5 mb-7">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-black text-slate-900">
                  Select Shop
                </h2>
                <p className="text-sm text-slate-500">
                  Manage each branch independently
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {visibleShops.map((shop) => (
                <button
                  key={shop.id}
                  onClick={() =>
                    setActiveShop(shop.id)
                  }
                  className={`py-3 px-2 rounded-2xl font-black text-sm sm:text-base transition ${
                    activeShop === shop.id
                      ? "bg-slate-950 text-white shadow-lg"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {shop.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* OVERVIEW */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          <div className="bg-slate-950 text-white rounded-3xl p-5 shadow-lg">
            <p className="text-slate-400 text-sm font-semibold">
              Total Stock
            </p>

            <p className="text-4xl font-black mt-2">
              {getTotalStock()}
            </p>

            <p className="text-slate-400 text-xs mt-1">
              Cylinders across all shops
            </p>
          </div>

          {profile?.role === "admin" ? (
            shops.map((shop) => (
              <div
                key={shop.id}
                className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm"
              >
                <div className="flex justify-between items-start">
                  <p className="text-sm font-semibold text-slate-500">
                    {shop.name}
                  </p>

                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mt-1" />
                </div>

                <p className="text-4xl font-black text-slate-950 mt-2">
                  {getShopStock(shop.id)}
                </p>

                <p className="text-xs text-slate-400 mt-1">
                  cylinders in stock
                </p>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">
                {activeShopData?.name} Stock
              </p>

              <p className="text-4xl font-black text-slate-950 mt-2">
                {activeShop
                  ? getShopStock(activeShop)
                  : 0}
              </p>

              <p className="text-xs text-slate-400 mt-1">
                cylinders in stock
              </p>
            </div>
          )}
        </section>
{/* STOCK ALERTS */}
{activeShop &&
  products.some(
    (product) =>
      getProductStock(activeShop, product.id) <= 5
  ) && (
    <section className="mb-8 rounded-3xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 shrink-0 rounded-2xl bg-amber-100 flex items-center justify-center text-xl">
          ⚠️
        </div>

        <div className="flex-1">
          <h2 className="font-black text-amber-900">
            Stock Alerts
          </h2>

          <p className="text-sm text-amber-700 mt-1">
            Check the following products:
          </p>

          <div className="flex flex-wrap gap-2 mt-3">
            {products
              .filter(
                (product) =>
                  getProductStock(
                    activeShop,
                    product.id
                  ) <= 5
              )
              .map((product) => {
                const quantity = getProductStock(
                  activeShop,
                  product.id
                );

                const productName =
                  product.category === "refill"
                    ? product.size
                    : `${product.brand} ${product.size}`;

                return (
                  <span
                    key={product.id}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold border ${
                      quantity === 0
                        ? "bg-red-100 text-red-700 border-red-200"
                        : "bg-white text-amber-800 border-amber-200"
                    }`}
                  >
                    {quantity === 0
                      ? `🔴 ${productName} • OUT OF STOCK`
                      : `⚠️ ${productName} • ${quantity} left`}
                  </span>
                );
              })}
          </div>
        </div>
      </div>
    </section>
  )}
        {/* SALES SUMMARY */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-500">
                  Total Sales
                </p>

                <p className="text-xs text-slate-400 mt-1">
                  All shops combined
                </p>
              </div>

              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl">
                KSh
              </div>
            </div>

            <p className="text-4xl font-black text-emerald-600 mt-5">
              KSh {getTotalSales().toLocaleString()}
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">
              Sales by Shop
            </p>

            <div className="mt-4 space-y-3">
              {visibleShops.map((shop) => (
                <div
                  key={shop.id}
                  className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3"
                >
                  <span className="font-bold text-slate-700">
                    {shop.name}
                  </span>

                  <span className="font-black text-slate-950">
                    KSh{" "}
                    {getShopSales(
                      shop.id
                    ).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PRODUCTS */}
        {activeShop && (
          <>
            {/* REFILLS */}
            <section className="mb-10">
              <div className="mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-8 rounded-full bg-emerald-500" />

                  <div>
                    <h2 className="text-2xl font-black text-slate-950">
                      Gas Refills
                    </h2>

                    <p className="text-sm text-slate-500">
                      {activeShopData?.name} • Refill stock
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {refills.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                  />
                ))}
              </div>
            </section>

            {/* NEW CYLINDERS */}
            <section className="mb-10">
              <div className="mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-8 rounded-full bg-slate-950" />

                  <div>
                    <h2 className="text-2xl font-black text-slate-950">
                      New Cylinders
                    </h2>

                    <p className="text-sm text-slate-500">
                      All available cylinder brands
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                <>
  {/* 6 KG */}
  <div className="lg:col-span-1">
    <div className="mb-3 flex items-center justify-between">
      <div>
        <h3 className="text-lg font-black text-slate-900">
          6 KG Cylinders
        </h3>
        <p className="text-xs text-slate-500">
          Small cylinder range
        </p>
      </div>

      <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white">
        6 KG
      </span>
    </div>

    <div className="space-y-4">
      {newCylinders
        .filter((product) => product.size === "6 KG")
        .map((product) => (
          <ProductCard
            key={product.id}
            product={product}
          />
        ))}
    </div>
  </div>

  {/* 13 KG */}
  <div className="lg:col-span-1">
    <div className="mb-3 flex items-center justify-between">
      <div>
        <h3 className="text-lg font-black text-slate-900">
          13 KG Cylinders
        </h3>
        <p className="text-xs text-slate-500">
          Large cylinder range
        </p>
      </div>

      <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">
        13 KG
      </span>
    </div>

    <div className="space-y-4">
      {newCylinders
        .filter((product) => product.size === "13 KG")
        .map((product) => (
          <ProductCard
            key={product.id}
            product={product}
          />
        ))}
    </div>
  </div>
</>
              </div>
            </section>
          </>
        )}

        {/* SALES HISTORY */}
        <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden mb-8">
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-950">
                  Sales History
                </h2>

                <p className="text-sm text-slate-500 mt-1">
                  Recent sales transactions
                </p>
              </div>

              <div className="bg-emerald-50 text-emerald-700 px-3 py-2 rounded-xl text-xs font-bold">
                {visibleSales.length} sales
              </div>
            </div>
          </div>

          {visibleSales.length === 0 ? (
            <div className="p-10 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center text-xl">
                📊
              </div>

              <p className="font-bold text-slate-700 mt-4">
                No sales recorded yet
              </p>

              <p className="text-sm text-slate-400 mt-1">
                Sales will appear here after a transaction.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left">
                    <th className="px-5 py-4 font-bold text-slate-500">
                      Shop
                    </th>

                    <th className="px-5 py-4 font-bold text-slate-500">
                      Product
                    </th>

                    <th className="px-5 py-4 font-bold text-slate-500">
                      Qty
                    </th>

                    <th className="px-5 py-4 font-bold text-slate-500">
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {visibleSales
                    .slice()
                    .reverse()
                    .map((sale, index) => {
                      const shop = shops.find(
                        (item) =>
                          item.id === sale.shop_id
                      );

                      const product = products.find(
                        (item) =>
                          item.id === sale.product_id
                      );

                      return (
                        <tr
                          key={index}
                          className="border-t border-slate-100 hover:bg-slate-50 transition"
                        >
                          <td className="px-5 py-4 font-bold text-slate-700">
                            {shop?.name || "Unknown"}
                          </td>

                          <td className="px-5 py-4 text-slate-600">
                            {product
                              ? product.category ===
                                "refill"
                                ? `${product.size} Refill`
                                : `${product.brand} ${product.size}`
                              : "Unknown"}
                          </td>

                          <td className="px-5 py-4 font-bold">
                            {sale.quantity || 0}
                          </td>

                          <td className="px-5 py-4 font-black text-emerald-600">
                            KSh{" "}
                            {Number(
                              sale.total_price
                            ).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ADMIN PANEL */}
        {profile?.role === "admin" && (
          <section className="bg-slate-950 rounded-3xl p-6 sm:p-8 text-white shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
              <div>
                <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider">
                  Administrator
                </div>

                <h2 className="text-2xl font-black mt-4">
                  Administrator Controls
                </h2>

                <p className="text-slate-400 text-sm mt-2 max-w-2xl">
                  You have full access to all SUPER GAS
                  shops, including prices, stock,
                  sales and reports.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/5 rounded-2xl px-4 py-3">
                  <p className="text-xs text-slate-500">
                    Shops
                  </p>
                  <p className="text-xl font-black">
                    {shops.length}
                  </p>
                </div>

                <div className="bg-white/5 rounded-2xl px-4 py-3">
                  <p className="text-xs text-slate-500">
                    Products
                  </p>
                  <p className="text-xl font-black">
                    {products.length}
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* FOOTER */}
        <footer className="text-center py-8">
          <p className="text-xs font-bold tracking-widest text-slate-400">
            SUPER GAS • STOCK & SALES MANAGEMENT
          </p>

          <p className="text-xs text-slate-400 mt-1">
            © 2026 SUPER GAS
          </p>
        </footer>
      </div>
    </main>
  );
}