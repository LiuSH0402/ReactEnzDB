import React from "react";
import Link from "next/link";

const Location = () => {
  const breadcrumbLinks = [
    { href: "/", text: "Home" },
    { href: "/contact", text: "Contact" },
  ];
  return (
    <>
      <section className="bg-primary py-24">
        <div className="container mx-auto lg:max-w-(--breakpoint-xl) md:max-w-(--breakpoint-md) px-4">
          <div className="">
            <div className="grid grid-cols-3 gap-24 border-b border-solid border-white/50 pb-11">
              <div>
                <h2 className="text-white text-4xl font-semibold">Pune Head Office</h2>
              </div>
              <div>
                <p className="text-18 font-semibold text-white/50">4292 Mapleview Drive Greenfield Zip code 38230</p>
              </div>
              <div>
                <Link href="mailto:headoffice@nicktio.com" className="text-18 text-white font-medium hover:text-white/80">headoffice@nicktio.com</Link>
                <Link href="tel:731-621-5503" className="text-18 text-white/80 flex items-center gap-2 hover:text-white w-fit"><span className="text-white/40">Call :</span>731-621-5503</Link>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-24 pt-12">
              <div>
                <h2 className="text-white text-4xl font-semibold">Bengaluru Office</h2>
              </div>
              <div>
                <p className="text-18 text-white/50 font-semibold">3502 Marcus Street Geraldine Zip code 35974</p>
              </div>
              <div>
                <Link href="mailto:Office@nicktio.com" className="text-18 text-white hover:text-white/80 font-medium">Office@nicktio.com</Link>
                <Link href="tel:731-235-7993" className="text-white/80 text-18 text-IceBlue flex items-center gap-2 hover:text-white w-fit"><span className="text-white/40">Call :</span>731-235-7993</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default Location;
